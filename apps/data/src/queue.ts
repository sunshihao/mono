import type { Redis } from "ioredis";
import type { Logger } from "pino";
import { z } from "zod";
import { sha256Hex } from "./lib/hash.js";

/**
 * 队列层（设计 §4.1 Event Queue / §5.3 幂等 / §11 并发隔离）。
 *
 *  - 每仓库一条 Redis Stream（data-sync:<repo>）：严格 per-repo FIFO，
 *    多个 worker 通过 SET NX 租约独占一个仓库的消费，天然水平扩展
 *  - delivery_id（GitHub X-GitHub-Delivery）经 processed 集合去重
 *  - 失败重试：ZADD 到全局延迟队列（score=重试时刻），ZPOPMIN 原子取出
 *    重投队尾，实现全局指数退避且无热循环；超最大重试 → 仓库 DLQ 流
 *  - 重放/乱序安全：sync 层以 state 为锚做 isAncestor 收敛检查，
 *    重复处理同一目标的结果一致（幂等 upsert）
 */

export const DATA_SYNC_GROUP = "data-sync-workers";
/** 全局延迟重试队列（ZSET：member=JSON 消息，score=可重试时刻 ms） */
export const DELAYED_KEY = "data-sync:delayed";

export function streamKey(repo: string): string {
    return `data-sync:${repo}`;
}
export function dlqKey(repo: string): string {
    return `data-sync:dlq:${repo}`;
}
export function leaseKey(repo: string): string {
    return `data-sync:lease:${repo}`;
}
export function processedKey(repo: string): string {
    return `data-sync:processed:${repo}`;
}

export const SyncMessageSchema = z.object({
    repo: z.string().min(1),
    /** 事件自带的 before（信息性字段；diff 起点以 state 为准） */
    before: z.string().min(1),
    after: z.string().min(1),
    ref: z.string().min(1),
    /** GitHub X-GitHub-Delivery 或 reconcile:<sha>（幂等去重键） */
    deliveryId: z.string().optional(),
    /** 已重试次数（重投队尾时 +1） */
    attempt: z.coerce.number().int().nonnegative().default(0),
});
export type SyncMessage = z.infer<typeof SyncMessageSchema>;

export function serializeMessage(msg: SyncMessage): Record<string, string> {
    return {
        repo: msg.repo,
        before: msg.before,
        after: msg.after,
        ref: msg.ref,
        deliveryId: msg.deliveryId ?? "",
        attempt: String(msg.attempt),
    };
}

export function parseMessage(
    fields: Record<string, string>,
): SyncMessage | null {
    const parsed = SyncMessageSchema.safeParse(fields);
    return parsed.success ? parsed.data : null;
}

/** webhook 幂等键：同一仓库同一目标 sha 的重复投递只入队一次 */
export function deliveryKeyFor(repo: string, afterSha: string): string {
    return sha256Hex(`${repo}:${afterSha}`);
}

/** Stream 操作（ioredis 实现；测试注入 fake） */
export interface StreamOps {
    xadd(key: string, fields: Record<string, string>): Promise<string>;
    ack(key: string, group: string, id: string): Promise<void>;
    /** XGROUP CREATE MKSTREAM（幂等：BUSYGROUP 忽略） */
    ensureGroup(key: string, group: string): Promise<void>;
    /** XAUTOCLAIM：接管崩溃 worker 遗留的 pending 消息（min-idle 后） */
    claimStale(
        key: string,
        group: string,
        consumer: string,
        minIdleMs: number,
    ): Promise<{ id: string; fields: Record<string, string> }[]>;
    /** XREADGROUP COUNT 1 BLOCK（无新消息返回 []） */
    readNew(
        key: string,
        group: string,
        consumer: string,
        blockMs: number,
    ): Promise<{ id: string; fields: Record<string, string> }[]>;
}

/** KV / 延迟队列操作（ioredis 实现；测试注入 fake） */
export interface KvOps {
    setNxEx(key: string, value: string, ttlMs: number): Promise<boolean>;
    setPx(key: string, value: string, ttlMs: number): Promise<void>;
    del(key: string): Promise<void>;
    sismember(key: string, member: string): Promise<boolean>;
    sadd(key: string, member: string): Promise<void>;
    expire(key: string, ttlSeconds: number): Promise<void>;
    zadd(key: string, score: number, member: string): Promise<void>;
    /** 原子弹出到期的延迟消息（score ≤ now），member 为 JSON 序列化的 SyncMessage */
    zpopmin(
        key: string,
        count: number,
    ): Promise<[member: string, score: number][]>;
}

function toFields(raw: string[] | undefined): Record<string, string> {
    const fields: Record<string, string> = {};
    const list = raw ?? [];
    for (let i = 0; i + 1 < list.length; i += 2) {
        fields[list[i]!] = list[i + 1] ?? "";
    }
    return fields;
}

export function createRedisStream(redis: Redis | null): StreamOps {
    const mustRedis = (): Redis => {
        if (!redis) throw new Error("redis not configured (REDIS_URL)");
        return redis;
    };
    return {
        async xadd(key, fields) {
            const flat: string[] = [];
            for (const [k, v] of Object.entries(fields)) flat.push(k, v);
            const id = await mustRedis().xadd(key, "*", ...flat);
            if (!id) throw new Error(`xadd ${key} failed`);
            return id;
        },
        async ack(key, group, id) {
            await mustRedis().xack(key, group, id);
        },
        async ensureGroup(key, group) {
            await mustRedis()
                .xgroup("CREATE", key, group, "0", "MKSTREAM")
                .catch((err: Error) => {
                    if (!err.message.includes("BUSYGROUP")) throw err;
                });
        },
        async claimStale(key, group, consumer, minIdleMs) {
            const res = (await mustRedis().xautoclaim(
                key,
                group,
                consumer,
                minIdleMs,
                "0",
                "COUNT",
                1,
            )) as unknown as [string, [string, string[]][], string[]];
            const entries = res[1] ?? [];
            return entries.map(([id, rawFields]) => ({
                id,
                fields: toFields(rawFields),
            }));
        },
        async readNew(key, group, consumer, blockMs) {
            const res = (await mustRedis().xreadgroup(
                "GROUP",
                group,
                consumer,
                "COUNT",
                1,
                "BLOCK",
                blockMs,
                "STREAMS",
                key,
                ">",
            )) as unknown as [string, [string, string[]][]][] | null;
            if (!res) return [];
            const out: { id: string; fields: Record<string, string> }[] = [];
            for (const [, entries] of res) {
                for (const [id, rawFields] of entries) {
                    out.push({ id, fields: toFields(rawFields) });
                }
            }
            return out;
        },
    };
}

export function createRedisKv(redis: Redis | null): KvOps {
    const mustRedis = (): Redis => {
        if (!redis) throw new Error("redis not configured (REDIS_URL)");
        return redis;
    };
    return {
        async setNxEx(key, value, ttlMs) {
            return (
                (await mustRedis().set(key, value, "PX", ttlMs, "NX")) === "OK"
            );
        },
        async setPx(key, value, ttlMs) {
            await mustRedis().set(key, value, "PX", ttlMs);
        },
        async del(key) {
            await mustRedis().del(key);
        },
        async sismember(key, member) {
            return (await mustRedis().sismember(key, member)) === 1;
        },
        async sadd(key, member) {
            await mustRedis().sadd(key, member);
        },
        async expire(key, ttlSeconds) {
            await mustRedis().expire(key, ttlSeconds);
        },
        async zadd(key, score, member) {
            await mustRedis().zadd(key, score, member);
        },
        async zpopmin(key, count) {
            const res = (await mustRedis().zpopmin(key, count)) as unknown as [
                string,
                string,
            ][];
            return (res ?? []).map(([member, score]) => [
                member,
                Number(score),
            ]);
        },
    };
}

/** 面向生产者的队列门面（webhook / reconcile 使用） */
export interface Queue {
    publish(msg: SyncMessage): Promise<string>;
    markProcessed(repo: string, deliveryId: string): Promise<void>;
    isProcessed(repo: string, deliveryId: string): Promise<boolean>;
    /** 超最大重试：写入仓库 DLQ 流 */
    toDlq(msg: SyncMessage, error: string): Promise<void>;
}

const PROCESSED_TTL_SECONDS = 7 * 24 * 3600;

/** redis 未配置时调用即抛 "redis not configured"（webhook → 503，worker 不启动） */
export function createQueue(redis: Redis | null, logger: Logger): Queue {
    const stream = createRedisStream(redis);
    const kv = createRedisKv(redis);
    return {
        async publish(msg) {
            const id = await stream.xadd(
                streamKey(msg.repo),
                serializeMessage(msg),
            );
            logger.info(
                {
                    repo: msg.repo,
                    streamId: id,
                    after: msg.after,
                    deliveryId: msg.deliveryId,
                },
                "sync event published",
            );
            return id;
        },
        async markProcessed(repo, deliveryId) {
            const key = processedKey(repo);
            await kv.sadd(key, deliveryId);
            await kv.expire(key, PROCESSED_TTL_SECONDS);
        },
        async isProcessed(repo, deliveryId) {
            return kv.sismember(processedKey(repo), deliveryId);
        },
        async toDlq(msg, error) {
            await stream.xadd(dlqKey(msg.repo), {
                ...serializeMessage(msg),
                error,
                dlqAt: new Date().toISOString(),
            });
        },
    };
}

/** 仓库消费租约：SET NX PX；独占消费，到期自动释放（崩溃自愈） */
export interface Lease {
    renew(): Promise<void>;
    release(): Promise<void>;
}

export async function tryAcquireLease(
    kv: KvOps,
    repo: string,
    ttlMs: number,
): Promise<Lease | null> {
    const key = leaseKey(repo);
    const acquired = await kv.setNxEx(key, String(process.pid), ttlMs);
    if (!acquired) return null;
    return {
        async renew() {
            await kv.setPx(key, String(process.pid), ttlMs);
        },
        async release() {
            await kv.del(key);
        },
    };
}

/** 延迟队列：失败消息延迟重投（全局指数退避，无热循环） */
export async function requeueDelayed(
    kv: KvOps,
    stream: StreamOps,
    msg: SyncMessage,
    delayMs: number,
): Promise<void> {
    const next: SyncMessage = { ...msg, attempt: msg.attempt + 1 };
    await kv.zadd(DELAYED_KEY, Date.now() + delayMs, JSON.stringify(next));
}

/** 取出到期的延迟消息并重投对应仓库流（worker 每轮调用） */
export async function flushDueDelayed(
    kv: KvOps,
    stream: StreamOps,
    limit = 10,
): Promise<number> {
    const due = await kv.zpopmin(DELAYED_KEY, limit);
    for (const [member] of due) {
        try {
            const parsed = SyncMessageSchema.safeParse(JSON.parse(member));
            if (parsed.success) {
                await stream.xadd(
                    streamKey(parsed.data.repo),
                    serializeMessage(parsed.data),
                );
            }
        } catch {
            // 损坏的延迟消息：丢弃（防毒丸堵住队列）
        }
    }
    return due.length;
}
