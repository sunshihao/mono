import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStateStore } from "../src/state.js";

let dir: string;

beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "data-state-"));
});

afterAll(async () => {
    // tmpdir 由系统清理，无需显式删除
});

describe("createStateStore", () => {
    it("write → read 往返一致", async () => {
        const store = createStateStore(dir);
        const state = {
            repo: "r1",
            branch: "main",
            last_synced_sha: "a".repeat(40),
            last_synced_at: "2026-08-24T10:00:00Z",
            status: "success" as const,
            stats: {
                added: 1,
                modified: 0,
                deleted: 0,
                renamed: 0,
                skipped: 0,
                points_upserted: 3,
                points_deleted: 0,
            },
        };
        await store.write(state);
        const read = await store.read("r1");
        expect(read).toEqual(state);
        // 原子写：无 tmp 残留
        const entries = await import("node:fs/promises").then((fs) =>
            fs.readdir(dir),
        );
        expect(entries.filter((e) => e.includes(".tmp-"))).toEqual([]);
    });

    it("不存在的仓库 → null（触发 backfill）", async () => {
        const store = createStateStore(dir);
        expect(await store.read("nope")).toBeNull();
    });

    it("损坏 JSON → null", async () => {
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, "broken.state.json"), "{ not json");
        const store = createStateStore(dir);
        expect(await store.read("broken")).toBeNull();
    });

    it("schema 不匹配 → null", async () => {
        await writeFile(
            join(dir, "bad.state.json"),
            JSON.stringify({ repo: "bad", last_synced_sha: "short" }),
        );
        const store = createStateStore(dir);
        expect(await store.read("bad")).toBeNull();
    });

    it("remove 幂等", async () => {
        const store = createStateStore(dir);
        await store.write({
            repo: "tmp1",
            branch: "main",
            last_synced_sha: "b".repeat(40),
            last_synced_at: "2026-08-24T10:00:00Z",
            status: "success",
        });
        await store.remove("tmp1");
        expect(await store.read("tmp1")).toBeNull();
        await expect(store.remove("tmp1")).resolves.toBeUndefined();
    });
});

describe("state file content", () => {
    it("落盘格式为 JSON", async () => {
        const store = createStateStore(dir);
        await store.write({
            repo: "fmt",
            branch: "main",
            last_synced_sha: "c".repeat(40),
            last_synced_at: "2026-08-24T10:00:00Z",
            status: "success",
        });
        const raw = await readFile(join(dir, "fmt.state.json"), "utf8");
        const parsed = JSON.parse(raw);
        expect(parsed.last_synced_sha).toBe("c".repeat(40));
    });
});
