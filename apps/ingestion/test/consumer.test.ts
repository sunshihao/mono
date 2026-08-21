import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pino } from "pino";
import { INGESTION_GROUP, INGESTION_STREAM } from "@repo/types";
import { startConsumer } from "../src/consumer.js";
import type { Indexer } from "../src/indexer.js";

interface FakeRedis {
    xgroup: (
        cmd: string,
        stream: string,
        group: string,
        id: string,
        mk: string,
    ) => Promise<void>;
    xreadgroup: (
        ...args: unknown[]
    ) => Promise<null | [string, [string, string[]][]][]>;
    xack: (stream: string, group: string, id: string) => Promise<number>;
}

function fakeRedis(
    entries: [string, string[]][],
): FakeRedis & { acks: string[] } {
    const acks: string[] = [];
    let readOnce = false;
    return {
        acks,
        xgroup: async () => undefined,
        xreadgroup: async () => {
            if (readOnce) {
                // 模拟 BLOCK 等待：保持 pending（立即 resolve 会空转饿死事件循环）
                return new Promise(() => undefined);
            }
            readOnce = true;
            return [[INGESTION_STREAM, entries]];
        },
        xack: async (_stream, _group, id) => {
            acks.push(id);
            return 1;
        },
    };
}

function fakeIndexer(ingested: string[]): Indexer {
    return {
        ensureCollection: async () => undefined,
        ingestFile: async (path, docHash) => {
            ingested.push(`${path}#${docHash}`);
            return { filePath: path, documentId: "x", chunks: 1, upserted: 1 };
        },
    };
}

const silent = pino({ level: "silent" });

async function drain(ms = 150): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("startConsumer 事件分发", () => {
    it("fs 事件 → ingestFile 调用 + XACK", async () => {
        const dir = await mkdtemp(join(tmpdir(), "consumer-"));
        const file = join(dir, "a.md");
        await writeFile(file, "内容");
        const docHash = "a".repeat(64);
        const ingested: string[] = [];

        const redis = fakeRedis([
            [
                "1-1",
                [
                    "event",
                    JSON.stringify({
                        id: "11111111-1111-1111-1111-111111111111",
                        source: "fs",
                        path: file,
                        doc_hash: docHash,
                        mtime: new Date().toISOString(),
                        status: "pending",
                    }),
                ],
            ],
        ]);
        const consumer = await startConsumer(
            redis as never,
            fakeIndexer(ingested),
            silent,
        );
        await drain();
        consumer.stop();

        expect(ingested).toEqual([`${file}#${docHash}`]);
        expect(redis.acks).toEqual(["1-1"]);
    });

    it("webhook 事件 → 跳过但 XACK（不死循环）", async () => {
        const ingested: string[] = [];
        const redis = fakeRedis([
            [
                "1-2",
                [
                    "event",
                    JSON.stringify({
                        id: "22222222-2222-2222-2222-222222222222",
                        source: "webhook",
                        path: "/n/remote-page",
                        doc_hash: "b".repeat(64),
                        mtime: new Date().toISOString(),
                        status: "pending",
                    }),
                ],
            ],
        ]);
        const consumer = await startConsumer(
            redis as never,
            fakeIndexer(ingested),
            silent,
        );
        await drain();
        consumer.stop();

        expect(ingested).toEqual([]);
        expect(redis.acks).toEqual(["1-2"]);
    });

    it("坏信封 → 跳过 + XACK", async () => {
        const ingested: string[] = [];
        const redis = fakeRedis([
            ["1-3", ["event", JSON.stringify({ broken: true })]],
        ]);
        const consumer = await startConsumer(
            redis as never,
            fakeIndexer(ingested),
            silent,
        );
        await drain();
        consumer.stop();

        expect(ingested).toEqual([]);
        expect(redis.acks).toEqual(["1-3"]);
    });

    it("ingest 抛错 → XACK 仍执行（不阻塞消费）", async () => {
        const redis = fakeRedis([
            [
                "1-4",
                [
                    "event",
                    JSON.stringify({
                        id: "33333333-3333-3333-3333-333333333333",
                        source: "fs",
                        path: "/nonexistent.md",
                        doc_hash: "c".repeat(64),
                        mtime: new Date().toISOString(),
                        status: "pending",
                    }),
                ],
            ],
        ]);
        const failing: Indexer = {
            ensureCollection: async () => undefined,
            ingestFile: async () => {
                throw new Error("file gone");
            },
        };
        const consumer = await startConsumer(redis as never, failing, silent);
        await drain();
        consumer.stop();

        expect(redis.acks).toEqual(["1-4"]);
    });

    it("创建 consumer group（幂等 BUSYGROUP 容忍）", async () => {
        const redis = fakeRedis([]);
        const busy = redis as FakeRedis & { acks: string[] };
        const originalXgroup = busy.xgroup;
        let calls = 0;
        busy.xgroup = async (cmd, stream, group) => {
            calls++;
            expect(cmd).toBe("CREATE");
            expect(stream).toBe(INGESTION_STREAM);
            expect(group).toBe(INGESTION_GROUP);
            throw new Error("BUSYGROUP Consumer Group name already exists");
        };
        void originalXgroup;
        const consumer = await startConsumer(
            redis as never,
            fakeIndexer([]),
            silent,
        );
        await drain();
        consumer.stop();
        expect(calls).toBe(1);
    });
});
