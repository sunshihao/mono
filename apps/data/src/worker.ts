import type { Logger } from "pino";
import type { DataConfig } from "./config.js";
import {
    DATA_SYNC_GROUP,
    flushDueDelayed,
    parseMessage,
    requeueDelayed,
    streamKey,
    tryAcquireLease,
    type KvOps,
    type Queue,
    type StreamOps,
    type SyncMessage,
} from "./queue.js";
import type { SyncService } from "./sync.js";

/**
 * Sync Worker（设计 §4.1 / §10 / §11）：
 *  - 每轮：先重投到期延迟消息 → 逐仓库 drain
 *  - drain：租约独占（SET NX，续期）→ XAUTOCLAIM 接管崩溃残留 → XREADGROUP 逐条处理
 *  - 处理：delivery 去重 → 超重试上限进 DLQ → sync（收敛/幂等由 sync 层保证）→ ack
 *  - 失败：ack 原消息 + ZADD 延迟队列（attempt+1，指数退避），消息离开流不热循环；
 *    同一仓库后续事件仍可继续处理（isAncestor 收敛检查保证乱序安全）
 */

export interface WorkerContext {
    config: DataConfig;
    stream: StreamOps;
    kv: KvOps;
    queue: Queue;
    syncService: SyncService;
    logger: Logger;
}

export interface WorkerOptions {
    /** 轮询间隔 ms（默认 1000） */
    pollIntervalMs?: number;
    /** 仓库消费租约 TTL ms（默认 10min；长 backfill 需大于单消息同步时长） */
    leaseMs?: number;
    /** XAUTOCLAIM min-idle：pending 消息滞留多久可被接管（默认 30s） */
    claimIdleMs?: number;
    /** 最大重试次数（超过进 DLQ），默认 5 */
    maxRetries?: number;
    /** 首次重试退避 ms（指数增长），默认 2000 */
    backoffBaseMs?: number;
}

export interface Worker {
    stop(): void;
}

export interface MessageHandlerContext {
    stream: StreamOps;
    kv: KvOps;
    queue: Queue;
    syncService: SyncService;
    logger: Logger;
}

export type MessageHandler = (
    repo: string,
    id: string,
    msg: SyncMessage,
) => Promise<void>;

/**
 * 单消息处理决策（独立导出便于单测）：
 * delivery 去重 → 超重试上限进 DLQ → sync → ack；
 * 失败：ack 原消息 + ZADD 延迟队列（attempt+1，指数退避），消息离开流不热循环。
 */
export function createMessageHandler(
    ctx: MessageHandlerContext,
    options: { maxRetries?: number; backoffBaseMs?: number } = {},
): MessageHandler {
    const maxRetries = options.maxRetries ?? 5;
    const backoffBaseMs = options.backoffBaseMs ?? 2000;

    return async (repo, id, msg) => {
        const key = streamKey(repo);
        const log = ctx.logger.child({ repo, streamId: id });

        if (
            msg.deliveryId &&
            (await ctx.queue.isProcessed(repo, msg.deliveryId))
        ) {
            await ctx.stream.ack(key, DATA_SYNC_GROUP, id);
            log.info(
                { deliveryId: msg.deliveryId },
                "duplicate delivery, ack and skip",
            );
            return;
        }
        if (msg.attempt >= maxRetries) {
            await ctx.stream.ack(key, DATA_SYNC_GROUP, id);
            await ctx.queue.toDlq(msg, `max retries (${msg.attempt}) exceeded`);
            log.error({ attempt: msg.attempt }, "message moved to DLQ");
            return;
        }

        try {
            const result = await ctx.syncService.syncRepo(repo, {
                targetSha: msg.after,
                logger: log,
            });
            // 先记 processed 再 ack：崩溃重放时靠 processed 去重补 ack
            if (msg.deliveryId) {
                await ctx.queue.markProcessed(repo, msg.deliveryId);
            }
            await ctx.stream.ack(key, DATA_SYNC_GROUP, id);
            log.info(
                { mode: result.mode, to: msg.after, stats: result.stats },
                "sync event processed",
            );
        } catch (err) {
            // 原消息出队，延迟副本入队（attempt+1）：重试不打乱队列，
            // 也不阻塞同一仓库的后续事件
            await ctx.stream
                .ack(key, DATA_SYNC_GROUP, id)
                .catch(() => undefined);
            const delayMs = Math.min(
                backoffBaseMs * 2 ** msg.attempt,
                5 * 60_000,
            );
            await requeueDelayed(ctx.kv, ctx.stream, msg, delayMs);
            log.warn(
                { attempt: msg.attempt + 1, delayMs, err },
                "sync failed, requeued delayed",
            );
        }
    };
}

export function startWorker(
    ctx: WorkerContext,
    options: WorkerOptions = {},
): Worker {
    const pollIntervalMs = options.pollIntervalMs ?? 1000;
    const leaseMs = options.leaseMs ?? 10 * 60_000;
    const claimIdleMs = options.claimIdleMs ?? 30_000;
    const consumer = `consumer-${process.pid}`;
    const processMessage = createMessageHandler(ctx, options);

    let running = true;
    let roundRunning = false;

    /** 逐条 drain 一个仓库的流，直到无新消息；返回是否处理过消息 */
    async function drainRepo(repo: string): Promise<void> {
        const key = streamKey(repo);
        await ctx.stream.ensureGroup(key, DATA_SYNC_GROUP);
        const lease = await tryAcquireLease(ctx.kv, repo, leaseMs);
        if (!lease) return; // 其他 worker 在消费此仓库

        try {
            for (;;) {
                // 1. 先接管崩溃 worker 遗留的 pending（min-idle 到期）
                const stale = await ctx.stream.claimStale(
                    key,
                    DATA_SYNC_GROUP,
                    consumer,
                    claimIdleMs,
                );
                for (const entry of stale) {
                    const msg = parseMessage(entry.fields);
                    if (!msg) {
                        await ctx.stream.ack(key, DATA_SYNC_GROUP, entry.id);
                        ctx.logger.warn(
                            { repo, streamId: entry.id },
                            "invalid message fields, ack and skip",
                        );
                        continue;
                    }
                    await processMessage(repo, entry.id, msg);
                }
                if (stale.length > 0) continue;

                // 2. 读新消息（单条阻塞读）
                const fresh = await ctx.stream.readNew(
                    key,
                    DATA_SYNC_GROUP,
                    consumer,
                    1000,
                );
                if (fresh.length === 0) break; // 流已排空
                for (const entry of fresh) {
                    const msg = parseMessage(entry.fields);
                    if (!msg) {
                        await ctx.stream.ack(key, DATA_SYNC_GROUP, entry.id);
                        ctx.logger.warn(
                            { repo, streamId: entry.id },
                            "invalid message fields, ack and skip",
                        );
                        continue;
                    }
                    await processMessage(repo, entry.id, msg);
                }
                await lease.renew();
            }
        } finally {
            await lease.release().catch(() => undefined);
        }
    }

    async function round(): Promise<void> {
        // 0. 重投到期延迟消息
        await flushDueDelayed(ctx.kv, ctx.stream).catch((err: unknown) => {
            ctx.logger.error({ err }, "flushDueDelayed failed");
        });
        for (const repo of ctx.config.repositories) {
            if (!running) break;
            try {
                await drainRepo(repo.name);
            } catch (err) {
                ctx.logger.error(
                    { repo: repo.name, err },
                    "drain repo failed, will retry next round",
                );
            }
        }
    }

    const timer = setInterval(() => {
        if (roundRunning) return; // 防重入
        roundRunning = true;
        void round()
            .catch((err: unknown) => {
                ctx.logger.error({ err }, "worker round failed");
            })
            .finally(() => {
                roundRunning = false;
            });
    }, pollIntervalMs);
    // 首轮立即执行
    void round().finally(() => {
        roundRunning = false;
    });

    ctx.logger.info(
        {
            group: DATA_SYNC_GROUP,
            pollIntervalMs,
            leaseMs,
            maxRetries: options.maxRetries ?? 5,
        },
        "sync worker started",
    );
    return {
        stop() {
            running = false;
            clearInterval(timer);
        },
    };
}
