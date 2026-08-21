import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RAG_COLLECTION, RAG_VECTOR_NAME } from "@repo/types";
import {
    createIndexer,
    type QdrantLike,
    type EmbedderLike,
} from "../src/indexer.js";
import { hashToUuid } from "../src/chunk.js";

function fakeQdrant() {
    const calls = {
        collections: 0,
        deletes: [] as unknown[],
        upserts: [] as unknown[],
    };
    const qdrant: QdrantLike = {
        getCollections: async () => {
            calls.collections++;
            return { collections: [] };
        },
        createCollection: async () => ({}),
        createPayloadIndex: async () => ({}),
        delete: async (_name, params) => {
            calls.deletes.push(params);
            return {};
        },
        upsert: async (_name, params) => {
            calls.upserts.push(params);
            return {};
        },
    };
    return { qdrant, calls };
}

function fakeEmbedder(): EmbedderLike {
    return {
        getTextEmbeddings: async (texts) =>
            texts.map((_, i) => [i, 0.1, 0.2] as number[]),
    };
}

describe("createIndexer.ingestFile", () => {
    it("切分 → 嵌入 → upsert，payload 对齐 ChunkPayload 形状", async () => {
        const dir = await mkdtemp(join(tmpdir(), "indexer-"));
        const file = join(dir, "doc.md");
        const content = "第一句。第二句。第三句。".repeat(30);
        await writeFile(file, content);

        const { qdrant, calls } = fakeQdrant();
        const indexer = await createIndexer(
            {
                qdrantUrl: "http://unused",
                openaiApiKey: "unused",
                chunkSize: 100,
                chunkOverlap: 20,
            },
            { qdrant, embedder: fakeEmbedder() },
        );

        const docHash = "a".repeat(64);
        const result = await indexer.ingestFile(file, docHash);

        expect(result.chunks).toBeGreaterThan(1);
        expect(result.documentId).toBe(hashToUuid(docHash));

        // 幂等重摄入：先按 document_id 删除旧点
        expect(calls.deletes).toHaveLength(1);
        // upsert 调用一次，点数 = 块数
        expect(calls.upserts).toHaveLength(1);
        const upsertParams = calls.upserts[0] as {
            points: Array<{
                id: string;
                vector: Record<string, number[]>;
                payload: Record<string, unknown>;
            }>;
        };
        expect(upsertParams.points).toHaveLength(result.chunks);
        for (const point of upsertParams.points) {
            expect(point.vector[RAG_VECTOR_NAME]).toHaveLength(3); // 假嵌入维度
            const p = point.payload;
            expect(p.node_id).toBe(point.id);
            expect(p.document_id).toBe(result.documentId);
            expect(p.ref_doc_id).toBe(result.documentId);
            expect(p.node_type).toBe("TextNode");
            expect(p.file_name).toBe("doc.md");
            expect(p.file_type).toBe("text/markdown");
            expect(p.doc_hash).toBe(docHash);
            expect(typeof p.start_char_idx).toBe("number");
            expect(typeof p.end_char_idx).toBe("number");
            expect(typeof p.text).toBe("string");
        }
    });

    it("ensureCollection 幂等初始化集合与 payload 索引", async () => {
        const { qdrant, calls } = fakeQdrant();
        const indexer = await createIndexer(
            { qdrantUrl: "http://unused", openaiApiKey: "unused" },
            { qdrant, embedder: fakeEmbedder() },
        );
        await indexer.ensureCollection();
        expect(calls.collections).toBe(1);
        // payload 索引创建（含已存在的幂等 catch）
        expect(calls.upserts).toHaveLength(0);
        expect(RAG_COLLECTION).toBe("knowledgeOfAI");
    });
});
