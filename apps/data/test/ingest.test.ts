import { describe, expect, it, vi } from "vitest";
import type { RepoConfig } from "../src/config.js";
import type { Embedder } from "../src/embed.js";
import type { GitOps } from "../src/git.js";
import { ingestChanges } from "../src/ingest.js";
import { sha256Hex } from "../src/lib/hash.js";
import {
    pointIdFor,
    type StoredPoint,
    type VectorPoint,
    type VectorStore,
} from "../src/vector.js";

/** 内存向量库 fake：记录 upsert/delete 调用，支持按 file_path 检索 */
class MemoryStore implements VectorStore {
    points = new Map<
        string,
        { id: string; vector: number[]; payload: Record<string, unknown> }
    >();
    upsertCalls: VectorPoint[][] = [];
    deleteCalls: string[][] = [];
    ensureCalls: string[] = [];

    async ensureCollection(collection: string, _dimensions: number) {
        this.ensureCalls.push(collection);
    }
    async upsert(collection: string, points: VectorPoint[]) {
        this.upsertCalls.push(points);
        for (const p of points) {
            this.points.set(p.id, { ...p });
        }
    }
    async deleteByIds(_collection: string, ids: string[]) {
        if (ids.length > 0) this.deleteCalls.push(ids);
        for (const id of ids) this.points.delete(id);
    }
    async deleteByRepo(_collection: string, _repo: string) {}
    async dropCollection(_collection: string) {}
    async listByFilePath(
        _collection: string,
        filePath: string,
        withVector: boolean,
    ): Promise<StoredPoint[]> {
        const out: StoredPoint[] = [];
        for (const p of this.points.values()) {
            if (p.payload["file_path"] === filePath) {
                out.push({
                    id: p.id,
                    payload: p.payload,
                    vector: withVector ? p.vector : undefined,
                });
            }
        }
        return out;
    }
}

/** 固定向量 fake（按文本长度区分，足够测试对齐关系） */
function fakeEmbedder(): { embedder: Embedder; calls: string[][] } {
    const calls: string[][] = [];
    const embedder: Embedder = {
        async embedTexts(texts) {
            calls.push(texts);
            return texts.map((t) => [t.length, 0.5, 0.25]);
        },
    };
    return { embedder, calls };
}

/** git fake：path → content 映射 */
function fakeGit(files: Record<string, string>): GitOps {
    return {
        ensureRepo: vi.fn(async () => {}),
        fetch: vi.fn(async () => {}),
        lsRemote: vi.fn(async () => "f".repeat(40)),
        diffNameStatus: vi.fn(async () => []),
        showFile: vi.fn(async (_p, _sha, filePath) => {
            const content = files[filePath];
            if (content === undefined)
                throw new Error(`no such file ${filePath}`);
            return Buffer.from(content, "utf8");
        }),
        isAncestor: vi.fn(async () => false),
    };
}

const TARGET = "c".repeat(40);

function repoConfig(overrides: Partial<RepoConfig> = {}): RepoConfig {
    return {
        name: "r1",
        github: "org/r1",
        local_path: "repos/r1",
        branch: "main",
        collection: "r1-main",
        include: ["**/*.md"],
        exclude: [],
        chunking: { strategy: "auto", chunk_size: 200, overlap: 20 },
        ...overrides,
    };
}

function change(
    status: "A" | "M" | "D" | "R",
    oldPath: string | null,
    newPath: string | null,
) {
    return { status, oldPath, newPath };
}

describe("ingestChanges", () => {
    it("A：读内容 → 切块 → 嵌入 → upsert 确定性 id 点", async () => {
        const store = new MemoryStore();
        const { embedder, calls } = fakeEmbedder();
        const content = "# T\n\n" + "abc ".repeat(100);
        const stats = await ingestChanges(
            repoConfig(),
            "/repos/r1",
            TARGET,
            [change("A", null, "docs/a.md")],
            { git: fakeGit({ "docs/a.md": content }), store, embedder },
            { dimensions: 1024 },
        );

        expect(stats.added).toBe(1);
        expect(stats.points_upserted).toBeGreaterThan(1);
        expect(calls).toHaveLength(1);
        expect(store.upsertCalls).toHaveLength(1);
        const points = store.upsertCalls[0]!;
        // 确定性 id + payload 完整性
        expect(points[0]!.id).toBe(pointIdFor("r1", "docs/a.md", 0));
        expect(points[0]!.payload).toMatchObject({
            repo: "r1",
            file_path: "docs/a.md",
            chunk_index: 0,
            commit_sha: TARGET,
            branch: "main",
            content_hash: sha256Hex(Buffer.from(content)),
        });
        expect(typeof points[0]!.payload["text"]).toBe("string");
        expect(typeof points[0]!.payload["updated_at"]).toBe("string");
        // 向量与 chunk 对齐
        expect(points[0]!.vector).toEqual([
            String(points[0]!.payload["text"]).length,
            0.5,
            0.25,
        ]);
    });

    it("exclude glob 命中的变更 → skipped", async () => {
        const store = new MemoryStore();
        const { embedder, calls } = fakeEmbedder();
        const stats = await ingestChanges(
            repoConfig({ exclude: ["private/**"] }),
            "/repos/r1",
            TARGET,
            [change("A", null, "private/secret.md")],
            { git: fakeGit({ "private/secret.md": "x" }), store, embedder },
        );
        expect(stats.skipped).toBe(1);
        expect(stats.points_upserted).toBe(0);
        expect(calls).toHaveLength(0);
    });

    it("二进制文件 → skipped", async () => {
        const store = new MemoryStore();
        const { embedder } = fakeEmbedder();
        const git = fakeGit({});
        git.showFile = vi.fn(async () => Buffer.from([0x00, 0x01, 0x02]));
        const stats = await ingestChanges(
            repoConfig(),
            "/repos/r1",
            TARGET,
            [change("A", null, "bin.md")],
            { git, store, embedder },
        );
        expect(stats.skipped).toBe(1);
    });

    it("M：文件变短时差集删除旧 chunk（设计 §7.2）", async () => {
        const store = new MemoryStore();
        const { embedder } = fakeEmbedder();
        // 预置 5 个旧点（旧内容 content_hash 不同）
        for (let i = 0; i < 5; i++) {
            store.points.set(pointIdFor("r1", "docs/a.md", i), {
                id: pointIdFor("r1", "docs/a.md", i),
                vector: [i, 0, 0],
                payload: {
                    repo: "r1",
                    file_path: "docs/a.md",
                    chunk_index: i,
                    commit_sha: "a".repeat(40),
                    content_hash: "old",
                },
            });
        }
        const content = "# short\n";
        const stats = await ingestChanges(
            repoConfig(),
            "/repos/r1",
            TARGET,
            [change("M", "docs/a.md", "docs/a.md")],
            { git: fakeGit({ "docs/a.md": content }), store, embedder },
            { dimensions: 1024 },
        );
        expect(stats.modified).toBe(1);
        // 新 chunk 1 个存活，旧 5 个中多余 4 个被删
        const remaining = await store.listByFilePath(
            "r1-main",
            "docs/a.md",
            false,
        );
        expect(remaining.map((p) => p.id)).toEqual([
            pointIdFor("r1", "docs/a.md", 0),
        ]);
        expect(store.deleteCalls.flat()).toEqual(
            expect.arrayContaining([
                pointIdFor("r1", "docs/a.md", 1),
                pointIdFor("r1", "docs/a.md", 4),
            ]),
        );
    });

    it("M：content_hash 未变 → 跳过免重嵌", async () => {
        const store = new MemoryStore();
        const { embedder, calls } = fakeEmbedder();
        const content = "# same\n";
        store.points.set(pointIdFor("r1", "docs/a.md", 0), {
            id: pointIdFor("r1", "docs/a.md", 0),
            vector: [1, 0, 0],
            payload: {
                repo: "r1",
                file_path: "docs/a.md",
                chunk_index: 0,
                content_hash: sha256Hex(Buffer.from(content)),
            },
        });
        const stats = await ingestChanges(
            repoConfig(),
            "/repos/r1",
            TARGET,
            [change("M", "docs/a.md", "docs/a.md")],
            { git: fakeGit({ "docs/a.md": content }), store, embedder },
        );
        expect(stats.skipped).toBe(1);
        expect(calls).toHaveLength(0);
        expect(store.deleteCalls).toHaveLength(0);
    });

    it("D：按 file_path 收集并删除全部点", async () => {
        const store = new MemoryStore();
        const { embedder } = fakeEmbedder();
        for (let i = 0; i < 3; i++) {
            store.points.set(pointIdFor("r1", "old.md", i), {
                id: pointIdFor("r1", "old.md", i),
                vector: [i, 0, 0],
                payload: { repo: "r1", file_path: "old.md", chunk_index: i },
            });
        }
        const stats = await ingestChanges(
            repoConfig(),
            "/repos/r1",
            TARGET,
            [change("D", "old.md", null)],
            { git: fakeGit({}), store, embedder },
        );
        expect(stats.deleted).toBe(1);
        expect(stats.points_deleted).toBe(3);
        expect(await store.listByFilePath("r1-main", "old.md", false)).toEqual(
            [],
        );
    });

    it("R：内容未变 → 向量搬运，不调 embedder", async () => {
        const store = new MemoryStore();
        const { embedder, calls } = fakeEmbedder();
        const content = "# stable\n";
        store.points.set(pointIdFor("r1", "old.md", 0), {
            id: pointIdFor("r1", "old.md", 0),
            vector: [7, 1, 1],
            payload: {
                repo: "r1",
                file_path: "old.md",
                chunk_index: 0,
                content_hash: sha256Hex(Buffer.from(content)),
                text: content,
            },
        });
        const stats = await ingestChanges(
            repoConfig(),
            "/repos/r1",
            TARGET,
            [change("R", "old.md", "new.md")],
            { git: fakeGit({ "new.md": content }), store, embedder },
        );
        expect(stats.renamed).toBe(1);
        expect(calls).toHaveLength(0); // 未重嵌
        const newPoint = (
            await store.listByFilePath("r1-main", "new.md", true)
        )[0];
        expect(newPoint).toBeDefined();
        expect(newPoint!.id).toBe(pointIdFor("r1", "new.md", 0));
        expect(newPoint!.vector).toEqual([7, 1, 1]); // 原向量
        expect(newPoint!.payload["commit_sha"]).toBe(TARGET);
        expect(await store.listByFilePath("r1-main", "old.md", false)).toEqual(
            [],
        );
    });

    it("R：内容变化 → 删旧 + 增新", async () => {
        const store = new MemoryStore();
        const { embedder, calls } = fakeEmbedder();
        store.points.set(pointIdFor("r1", "old.md", 0), {
            id: pointIdFor("r1", "old.md", 0),
            vector: [1, 0, 0],
            payload: {
                repo: "r1",
                file_path: "old.md",
                chunk_index: 0,
                content_hash: "different",
            },
        });
        const stats = await ingestChanges(
            repoConfig(),
            "/repos/r1",
            TARGET,
            [change("R", "old.md", "new.md")],
            { git: fakeGit({ "new.md": "changed content" }), store, embedder },
        );
        expect(stats.renamed).toBe(1);
        expect(calls).toHaveLength(1);
        expect(await store.listByFilePath("r1-main", "old.md", false)).toEqual(
            [],
        );
        expect(
            (await store.listByFilePath("r1-main", "new.md", false)).length,
        ).toBe(1);
    });

    it("R：移入/移出 include 范围按 A/D 处理", async () => {
        const store = new MemoryStore();
        const { embedder } = fakeEmbedder();
        const git = fakeGit({ "src/new.md": "content" });
        // 移入（old 不在范围）→ A
        const inStats = await ingestChanges(
            repoConfig(),
            "/repos/r1",
            TARGET,
            [change("R", "legacy/old.txt", "src/new.md")],
            { git, store, embedder },
        );
        expect(inStats.added).toBe(1);
        expect(inStats.renamed).toBe(0);
        // 移出（new 不在范围）→ D
        store.points.set(pointIdFor("r1", "docs/gone.md", 0), {
            id: pointIdFor("r1", "docs/gone.md", 0),
            vector: [1, 0, 0],
            payload: { repo: "r1", file_path: "docs/gone.md", chunk_index: 0 },
        });
        const outStats = await ingestChanges(
            repoConfig(),
            "/repos/r1",
            TARGET,
            [change("R", "docs/gone.md", "legacy/out.txt")],
            { git: fakeGit({}), store, embedder },
        );
        expect(outStats.deleted).toBe(1);
    });

    it("dry-run：不嵌不写，只报规划数量", async () => {
        const content = "# T\n\n" + "x".repeat(500);
        const stats = await ingestChanges(
            repoConfig(),
            "/repos/r1",
            TARGET,
            [change("A", null, "docs/a.md")],
            { git: fakeGit({ "docs/a.md": content }) },
            { dryRun: true },
        );
        expect(stats.added).toBe(1);
        expect(stats.points_upserted).toBeGreaterThan(1);
    });

    it("deps 缺失且非 dry-run → 抛错", async () => {
        await expect(
            ingestChanges(
                repoConfig(),
                "/repos/r1",
                TARGET,
                [change("A", null, "docs/a.md")],
                { git: fakeGit({ "docs/a.md": "x" }) },
            ),
        ).rejects.toThrow(/vector store/);
    });
});
