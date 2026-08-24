import { describe, expect, it, vi } from "vitest";
import type { RepoConfig } from "../src/config.js";
import { EMPTY_TREE_SHA, type GitOps } from "../src/git.js";
import type { StateStore, SyncState, SyncStats } from "../src/state.js";
import { syncRepo } from "../src/sync.js";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);

const EMPTY_STATS: SyncStats = {
    added: 0,
    modified: 0,
    deleted: 0,
    renamed: 0,
    skipped: 0,
    points_upserted: 0,
    points_deleted: 0,
};

function repoConfig(): RepoConfig {
    return {
        name: "r1",
        github: "org/r1",
        local_path: "repos/r1",
        branch: "main",
        collection: "r1-main",
        include: ["**/*"],
        exclude: [],
        chunking: { strategy: "fixed_size", chunk_size: 100, overlap: 10 },
    };
}

interface GitFakeOptions {
    head?: string;
    ancestry?: (a: string, b: string) => boolean;
    changes?: {
        status: "A" | "M" | "D" | "R";
        oldPath: string | null;
        newPath: string | null;
    }[];
}

function fakeGit(options: GitFakeOptions = {}): GitOps {
    const head = options.head ?? SHA_C;
    return {
        ensureRepo: vi.fn(async () => {}),
        fetch: vi.fn(async () => {}),
        lsRemote: vi.fn(async () => head),
        diffNameStatus: vi.fn(async () => options.changes ?? []),
        showFile: vi.fn(async () => Buffer.from("x")),
        isAncestor: vi.fn(
            async (_p, a, b) => options.ancestry?.(a, b) ?? false,
        ),
    };
}

class MemoryState implements StateStore {
    states = new Map<string, SyncState>();
    writes: SyncState[] = [];
    async read(repo: string) {
        return this.states.get(repo) ?? null;
    }
    async write(state: SyncState) {
        this.writes.push(state);
        this.states.set(state.repo, state);
    }
    async remove(repo: string) {
        this.states.delete(repo);
    }
}

function stateAt(sha: string): SyncState {
    return {
        repo: "r1",
        branch: "main",
        last_synced_sha: sha,
        last_synced_at: "2026-08-24T10:00:00Z",
        status: "success",
    };
}

function makeDeps(state: MemoryState, git: GitOps) {
    const ingest = vi.fn(async () => EMPTY_STATS);
    return { state, git, ingest };
}

describe("syncRepo", () => {
    it("无状态 → 空树 backfill，成功后写 state", async () => {
        const state = new MemoryState();
        const git = fakeGit({ head: SHA_C });
        const deps = makeDeps(state, git);
        const result = await syncRepo(repoConfig(), "/repos/r1", deps);

        expect(result.mode).toBe("backfill");
        expect(result.from).toBe(EMPTY_TREE_SHA);
        expect(result.to).toBe(SHA_C);
        expect(deps.ingest).toHaveBeenCalledOnce();
        expect(state.writes).toHaveLength(1);
        expect(state.writes[0]!.last_synced_sha).toBe(SHA_C);
    });

    it("状态 == 目标 → up-to-date，不触发 ingest", async () => {
        const state = new MemoryState();
        await state.write(stateAt(SHA_C));
        const git = fakeGit({ head: SHA_C });
        const deps = makeDeps(state, git);
        const result = await syncRepo(repoConfig(), "/repos/r1", deps);

        expect(result.mode).toBe("up-to-date");
        expect(deps.ingest).not.toHaveBeenCalled();
        expect(state.writes).toHaveLength(1); // 仅 setup 的写入，无新推进
    });

    it("状态落后 → incremental 增量，状态推进到目标", async () => {
        const state = new MemoryState();
        await state.write(stateAt(SHA_A));
        const git = fakeGit({
            head: SHA_B,
            ancestry: (a, b) => a === SHA_A && b === SHA_B,
            changes: [{ status: "M", oldPath: "a.md", newPath: "a.md" }],
        });
        const deps = makeDeps(state, git);
        const result = await syncRepo(repoConfig(), "/repos/r1", deps);

        expect(result.mode).toBe("incremental");
        expect(result.from).toBe(SHA_A);
        expect(deps.ingest).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            SHA_B,
            [{ status: "M", oldPath: "a.md", newPath: "a.md" }],
            expect.anything(),
        );
        expect(state.writes.at(-1)!.last_synced_sha).toBe(SHA_B);
    });

    it("旧事件重放（目标已被状态覆盖）→ stale-skipped", async () => {
        const state = new MemoryState();
        await state.write(stateAt(SHA_C));
        const git = fakeGit({
            head: SHA_C, // ls-remote 仍是头；目标由 targetSha 指定为旧 sha
            ancestry: (a, b) => a === SHA_B && b === SHA_C,
        });
        const deps = makeDeps(state, git);
        const result = await syncRepo(repoConfig(), "/repos/r1", deps, {
            targetSha: SHA_B,
        });

        expect(result.mode).toBe("stale-skipped");
        expect(deps.ingest).not.toHaveBeenCalled();
        expect(state.writes).toHaveLength(1); // 仅 setup 的写入，无新推进
    });

    it("forceBackfill：无视状态全量重建", async () => {
        const state = new MemoryState();
        await state.write(stateAt(SHA_C));
        const git = fakeGit({ head: SHA_C });
        const deps = makeDeps(state, git);
        const result = await syncRepo(repoConfig(), "/repos/r1", deps, {
            forceBackfill: true,
        });

        expect(result.mode).toBe("backfill");
        expect(result.from).toBe(EMPTY_TREE_SHA);
    });

    it("ingest 失败 → 状态不推进（事务化，设计 §10），错误上抛", async () => {
        const state = new MemoryState();
        await state.write(stateAt(SHA_A));
        const git = fakeGit({ head: SHA_B });
        const deps = makeDeps(state, git);
        deps.ingest = vi.fn(async () => {
            throw new Error("embedding down");
        });

        await expect(syncRepo(repoConfig(), "/repos/r1", deps)).rejects.toThrow(
            "embedding down",
        );
        expect(state.writes).toHaveLength(1); // 仅 setup 的写入，失败未推进
        expect((await state.read("r1"))!.last_synced_sha).toBe(SHA_A);
    });

    it("dry-run：不写状态", async () => {
        const state = new MemoryState();
        const git = fakeGit({ head: SHA_C });
        const deps = makeDeps(state, git);
        const result = await syncRepo(repoConfig(), "/repos/r1", deps, {
            dryRun: true,
        });

        expect(result.mode).toBe("backfill");
        expect(state.writes).toHaveLength(0);
        expect(await state.read("r1")).toBeNull();
    });

    it("last_synced 非目标祖先（force-push）→ 警告后照常 diff", async () => {
        const state = new MemoryState();
        await state.write(stateAt(SHA_A));
        const git = fakeGit({
            head: SHA_B,
            ancestry: () => false, // A 不是 B 的祖先
        });
        const deps = makeDeps(state, git);
        const result = await syncRepo(repoConfig(), "/repos/r1", deps);

        expect(result.mode).toBe("incremental");
        expect(deps.ingest).toHaveBeenCalledOnce();
        expect(state.writes.at(-1)!.last_synced_sha).toBe(SHA_B);
    });
});
