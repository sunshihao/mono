import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/lib/logger.js";
import {
    deliveryKeyFor,
    flushDueDelayed,
    parseMessage,
    requeueDelayed,
    serializeMessage,
    tryAcquireLease,
    type KvOps,
    type StreamOps,
    type SyncMessage,
} from "../src/queue.js";
import type { SyncResult } from "../src/sync.js";
import { createMessageHandler } from "../src/worker.js";

const MSG: SyncMessage = {
    repo: "r1",
    before: "a".repeat(40),
    after: "b".repeat(40),
    ref: "refs/heads/main",
    deliveryId: "d-1",
    attempt: 0,
};

describe("message 序列化", () => {
    it("serialize/parse 往返一致（attempt 字符串强制转数字）", () => {
        const fields = serializeMessage(MSG);
        const parsed = parseMessage(fields);
        expect(parsed).toEqual(MSG);
        expect(parseMessage({ ...fields, attempt: "3" })).toMatchObject({
            attempt: 3,
        });
    });

    it("非法字段 → null", () => {
        expect(parseMessage({ repo: "" })).toBeNull();
        expect(
            parseMessage({ repo: "r1", before: "x", after: "y" }),
        ).toBeNull();
    });

    it("deliveryKeyFor 确定性", () => {
        const k1 = deliveryKeyFor("r1", MSG.after);
        const k2 = deliveryKeyFor("r1", MSG.after);
        expect(k1).toBe(k2);
        expect(k1).toMatch(/^[0-9a-f]{64}$/);
        expect(k1).not.toBe(deliveryKeyFor("r2", MSG.after));
    });
});

/** 记录型 fake（xadd/zadd 等只记录调用） */
function fakeKv(): KvOps & {
    zaddCalls: [string, number, string][];
    keys: Set<string>;
} {
    const keys = new Set<string>();
    const zaddCalls: [string, number, string][] = [];
    return {
        keys,
        zaddCalls,
        setNxEx: vi.fn(async (key: string, _value: string) => {
            if (keys.has(key)) return false;
            keys.add(key);
            return true;
        }),
        setPx: vi.fn(async () => {}),
        del: vi.fn(async (key: string) => {
            keys.delete(key);
        }),
        sismember: vi.fn(async () => false),
        sadd: vi.fn(async () => {}),
        expire: vi.fn(async () => {}),
        zadd: vi.fn(async (key: string, score: number, member: string) => {
            zaddCalls.push([key, score, member]);
        }),
        zpopmin: vi.fn(async () => []),
    };
}

function fakeStream(): StreamOps & {
    xaddCalls: [string, Record<string, string>][];
    ackCalls: [string, string, string][];
} {
    const xaddCalls: [string, Record<string, string>][] = [];
    const ackCalls: [string, string, string][] = [];
    return {
        xaddCalls,
        ackCalls,
        xadd: vi.fn(async (key: string, fields: Record<string, string>) => {
            xaddCalls.push([key, fields]);
            return "id";
        }),
        ack: vi.fn(async (key: string, group: string, id: string) => {
            ackCalls.push([key, group, id]);
        }),
        ensureGroup: vi.fn(async () => {}),
        claimStale: vi.fn(async () => []),
        readNew: vi.fn(async () => []),
    };
}

describe("requeueDelayed / flushDueDelayed", () => {
    it("失败消息延迟重投：attempt+1、score=now+delay", async () => {
        const kv = fakeKv();
        const stream = fakeStream();
        const before = Date.now();
        await requeueDelayed(kv, stream, MSG, 4000);
        expect(kv.zaddCalls).toHaveLength(1);
        const [key, score, member] = kv.zaddCalls[0]!;
        expect(key).toBe("data-sync:delayed");
        expect(score).toBeGreaterThanOrEqual(before + 4000);
        const parsed = JSON.parse(member) as SyncMessage;
        expect(parsed.attempt).toBe(1);
    });

    it("到期消息弹出重投队尾；损坏消息丢弃", async () => {
        const kv = fakeKv();
        const stream = fakeStream();
        kv.zpopmin = vi.fn(
            async () =>
                [
                    [JSON.stringify({ ...MSG, attempt: 2 }), 1],
                    ["{corrupt", 2],
                ] as [string, number][],
        );
        const count = await flushDueDelayed(kv, stream);
        expect(count).toBe(2);
        expect(stream.xaddCalls).toHaveLength(1);
        expect(stream.xaddCalls[0]![0]).toBe("data-sync:r1");
        expect(stream.xaddCalls[0]![1]["attempt"]).toBe("2");
    });
});

describe("tryAcquireLease", () => {
    it("获取 → renew → release；已被持有 → null", async () => {
        const kv = fakeKv();
        const lease = await tryAcquireLease(kv, "r1", 60_000);
        expect(lease).not.toBeNull();
        await lease!.renew();
        await lease!.release();
        expect(kv.keys.has("data-sync:lease:r1")).toBe(false);

        // 抢占场景
        kv.keys.add("data-sync:lease:r1");
        expect(await tryAcquireLease(kv, "r1", 60_000)).toBeNull();
    });
});

describe("createMessageHandler（worker 消息决策）", () => {
    const logger = createLogger("silent");

    function handlerWith(
        overrides: {
            isProcessed?: boolean;
            syncImpl?: (repo: string) => Promise<SyncResult>;
            maxRetries?: number;
        } = {},
    ) {
        const stream = fakeStream();
        const kv = fakeKv();
        const queue = {
            isProcessed: vi.fn(async () => overrides.isProcessed ?? false),
            markProcessed: vi.fn(async () => {}),
            toDlq: vi.fn(async () => {}),
            publish: vi.fn(async () => "id"),
        };
        const emptyStats = {
            added: 0,
            modified: 0,
            deleted: 0,
            renamed: 0,
            skipped: 0,
            points_upserted: 0,
            points_deleted: 0,
        };
        const syncService = {
            syncRepo: vi.fn(async (repo: string) => {
                if (overrides.syncImpl) return overrides.syncImpl(repo);
                return {
                    repo,
                    mode: "incremental",
                    from: "a",
                    to: "b",
                    stats: emptyStats,
                    durationMs: 1,
                } as SyncResult;
            }),
        };
        const handler = createMessageHandler(
            { stream, kv, queue, syncService, logger },
            { maxRetries: overrides.maxRetries ?? 5, backoffBaseMs: 2000 },
        );
        return { handler, stream, kv, queue, syncService };
    }

    it("已处理的 delivery → 只 ack 不同步", async () => {
        const { handler, stream, syncService } = handlerWith({
            isProcessed: true,
        });
        await handler("r1", "s-1", MSG);
        expect(stream.ackCalls).toEqual([
            ["data-sync:r1", "data-sync-workers", "s-1"],
        ]);
        expect(syncService.syncRepo).not.toHaveBeenCalled();
    });

    it("成功同步 → markProcessed + ack", async () => {
        const { handler, stream, queue, syncService } = handlerWith();
        await handler("r1", "s-1", MSG);
        expect(syncService.syncRepo).toHaveBeenCalledWith("r1", {
            targetSha: MSG.after,
            logger: expect.anything(),
        });
        expect(queue.markProcessed).toHaveBeenCalledWith("r1", "d-1");
        expect(stream.ackCalls.at(-1)).toEqual([
            "data-sync:r1",
            "data-sync-workers",
            "s-1",
        ]);
    });

    it("超过最大重试 → ack + DLQ，不再同步", async () => {
        const { handler, stream, queue, syncService } = handlerWith({
            maxRetries: 5,
        });
        await handler("r1", "s-1", { ...MSG, attempt: 5 });
        expect(syncService.syncRepo).not.toHaveBeenCalled();
        expect(queue.toDlq).toHaveBeenCalledOnce();
        expect(stream.ackCalls.at(-1)).toEqual([
            "data-sync:r1",
            "data-sync-workers",
            "s-1",
        ]);
    });

    it("同步失败 → ack 原消息 + ZADD 延迟队列（attempt+1）", async () => {
        const { handler, stream, kv } = handlerWith({
            syncImpl: () => {
                throw new Error("embedding 500");
            },
        });
        await handler("r1", "s-1", MSG);
        expect(stream.ackCalls.at(-1)).toEqual([
            "data-sync:r1",
            "data-sync-workers",
            "s-1",
        ]);
        expect(kv.zaddCalls).toHaveLength(1);
        const [key, , member] = kv.zaddCalls[0]!;
        expect(key).toBe("data-sync:delayed");
        expect((JSON.parse(member) as SyncMessage).attempt).toBe(1);
    });

    it("退避随 attempt 指数增长", async () => {
        const { handler, kv } = handlerWith({
            syncImpl: () => {
                throw new Error("x");
            },
        });
        await handler("r1", "s-1", { ...MSG, attempt: 3 });
        const [, score] = kv.zaddCalls[0]!;
        expect(score - Date.now()).toBeGreaterThanOrEqual(2000 * 2 ** 3 - 100);
    });
});
