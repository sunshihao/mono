import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pino } from "pino";
import { computeFileHashes, sha256Hex } from "../src/hash.js";
import { createStreamClient } from "../src/stream.js";
import { INGESTION_NOTIFICATION_CHANNEL, INGESTION_STREAM } from "@repo/types";

describe("sha256Hex / computeFileHashes", () => {
    it("确定性：同内容同 hash，不同内容不同 hash，64 位 hex", async () => {
        const dir = await mkdtemp(join(tmpdir(), "ingest-hash-"));
        await writeFile(join(dir, "a.md"), "内容一");
        await writeFile(join(dir, "b.md"), "内容二");
        await mkdir(join(dir, "sub"));
        await writeFile(join(dir, "sub", "c.md"), "内容一");

        const hashes = await computeFileHashes(dir);
        expect(hashes.size).toBe(3);

        const [a, b, c] = [
            hashes.get(join(dir, "a.md")),
            hashes.get(join(dir, "b.md")),
            hashes.get(join(dir, "sub", "c.md")),
        ];
        expect(a).toMatch(/^[0-9a-f]{64}$/);
        expect(a).toBe(c); // 同内容同 hash
        expect(a).not.toBe(b);

        expect(sha256Hex("内容一")).toBe(a);
    });
});

describe("createStreamClient", () => {
    const silent = pino({ level: "silent" });

    it("redis 未配置 → warn 跳过，仍返回合法信封", async () => {
        const client = createStreamClient(null, silent);
        const envelope = await client.publish(
            "fs",
            "/data/a.md",
            "a".repeat(64),
        );
        expect(envelope.source).toBe("fs");
        expect(envelope.doc_hash).toBe("a".repeat(64));
        expect(envelope.status).toBe("pending");
        expect(envelope.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("redis 配置 → XADD 到 INGESTION_STREAM，事件为信封 JSON", async () => {
        const xadd = { calls: [] as unknown[][] };
        const pubsub = { calls: [] as unknown[][] };
        const fakeRedis = {
            xadd: async (...args: unknown[]) => {
                xadd.calls.push(args);
                return "id";
            },
            publish: async (...args: unknown[]) => {
                pubsub.calls.push(args);
                return 1;
            },
        };
        const client = createStreamClient(fakeRedis as never, silent);
        await client.publish("webhook", "/n/page", "b".repeat(64));

        expect(xadd.calls).toHaveLength(1);
        // PubSub 通知：XADD 后 PUBLISH 到通知频道
        expect(pubsub.calls).toHaveLength(1);
        expect(pubsub.calls[0]![0]).toBe(INGESTION_NOTIFICATION_CHANNEL);
        const [key, id, field, value] = xadd.calls[0]!;
        expect(key).toBe(INGESTION_STREAM);
        expect(id).toBe("*");
        expect(field).toBe("event");
        const parsed = JSON.parse(value as string);
        expect(parsed.doc_hash).toBe("b".repeat(64));
        expect(parsed.source).toBe("webhook");
    });
});
