import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { QdrantClient } from "@qdrant/js-client-rest";
import { OpenAIEmbedding } from "@llamaindex/openai";
import { RAG_COLLECTION, RAG_VECTOR_NAME, RAG_VECTOR_SIZE } from "@repo/types";
import { hashToUuid, mimeFromPath, splitText } from "./chunk.js";

export interface IndexerConfig {
    qdrantUrl: string;
    qdrantApiKey?: string;
    openaiApiKey: string;
    /** DashScope OpenAI 兼容端点 */
    openaiBaseUrl?: string;
    chunkSize?: number;
    chunkOverlap?: number;
    /** DashScope 嵌入批量上限内的小批次（原型 embed_batch_size=5） */
    embedBatchSize?: number;
}

export interface IngestResult {
    filePath: string;
    documentId: string;
    chunks: number;
    upserted: number;
}

export interface Indexer {
    /** 幂等初始化集合与 payload 索引（对齐 migrate_to_qdrant.py 的配置） */
    ensureCollection(): Promise<void>;
    /** 切分 → 嵌入 → upsert；同一 doc_hash 重摄入时先删旧点（幂等） */
    ingestFile(path: string, docHash: string): Promise<IngestResult>;
}

/** 测试注入用最小接口（QdrantClient / OpenAIEmbedding 结构化兼容） */
export interface EmbedderLike {
    getTextEmbeddings(texts: string[]): Promise<number[][]>;
}

export interface QdrantLike {
    getCollections(): Promise<{ collections: { name: string }[] }>;
    createCollection(name: string, params: unknown): Promise<unknown>;
    createPayloadIndex(name: string, params: unknown): Promise<unknown>;
    delete(name: string, params: unknown): Promise<unknown>;
    upsert(name: string, params: unknown): Promise<unknown>;
}

export interface IndexerDeps {
    qdrant?: QdrantLike;
    embedder?: EmbedderLike;
}

export async function createIndexer(
    config: IndexerConfig,
    deps: IndexerDeps = {},
): Promise<Indexer> {
    const client: QdrantLike =
        deps.qdrant ??
        new QdrantClient({
            url: config.qdrantUrl,
            apiKey: config.qdrantApiKey,
        });
    const embedModel: EmbedderLike =
        deps.embedder ??
        new OpenAIEmbedding({
            model: "text-embedding-v4",
            dimensions: 1024,
            apiKey: config.openaiApiKey,
            ...(config.openaiBaseUrl ? { baseURL: config.openaiBaseUrl } : {}),
        });
    const chunkSize = config.chunkSize ?? 512;
    const chunkOverlap = config.chunkOverlap ?? 50;
    const batchSize = config.embedBatchSize ?? 5;

    async function ensureCollection(): Promise<void> {
        const { collections } = await client.getCollections();
        if (!collections.some((c) => c.name === RAG_COLLECTION)) {
            await client.createCollection(RAG_COLLECTION, {
                vectors: {
                    [RAG_VECTOR_NAME]: {
                        size: RAG_VECTOR_SIZE,
                        distance: "Cosine",
                    },
                },
            });
        }
        // payload 索引（幂等：已存在时 Qdrant 返回错误，忽略即可）
        for (const field of [
            "ref_doc_id",
            "document_id",
            "file_name",
            "file_path",
            "node_type",
        ]) {
            const fieldType =
                field === "file_name" || field === "file_path"
                    ? "text"
                    : "keyword";
            await client
                .createPayloadIndex(RAG_COLLECTION, {
                    field_name: field,
                    field_schema: fieldType,
                })
                .catch(() => undefined);
        }
    }

    async function ingestFile(
        path: string,
        docHash: string,
    ): Promise<IngestResult> {
        const content = await readFile(path, "utf8");
        const chunks = splitText(content, { chunkSize, chunkOverlap });
        const documentId = hashToUuid(docHash);
        const filePath = path;
        const fileName = basename(path);
        const fileType = mimeFromPath(path);

        // 幂等重摄入：先清掉同 doc_hash 的旧点
        await client.delete(RAG_COLLECTION, {
            filter: {
                must: [{ key: "document_id", match: { value: documentId } }],
            },
        });

        // 分批嵌入（DashScope 单次 batch 有上限）
        const embeddings: number[][] = [];
        for (let i = 0; i < chunks.length; i += batchSize) {
            const batch = chunks.slice(i, i + batchSize).map((c) => c.text);
            const result = await embedModel.getTextEmbeddings(batch);
            embeddings.push(...result);
        }

        // node_id 与 point id 保持一致（对齐 migrate_to_qdrant.py 的 id=node_id 约定）
        const points = chunks.map((chunk, i) => {
            const id = randomUUID();
            return {
                id,
                vector: { [RAG_VECTOR_NAME]: embeddings[i]! },
                payload: {
                    node_id: id,
                    text: chunk.text,
                    file_path: filePath,
                    file_name: fileName,
                    file_type: fileType,
                    node_type: "TextNode",
                    ref_doc_id: documentId,
                    document_id: documentId,
                    start_char_idx: chunk.startCharIdx,
                    end_char_idx: chunk.endCharIdx,
                    doc_hash: docHash,
                },
            };
        });

        await client.upsert(RAG_COLLECTION, { points, wait: true });

        return {
            filePath,
            documentId,
            chunks: chunks.length,
            upserted: points.length,
        };
    }

    return { ensureCollection, ingestFile };
}
