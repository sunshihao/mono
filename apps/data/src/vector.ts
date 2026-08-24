import { createHash } from "node:crypto";
import { QdrantClient } from "@qdrant/js-client-rest";

/**
 * Qdrant 向量库封装（设计 §7）。
 * point id 确定性生成 → 重复处理同一 (repo, file_path, chunk_index)
 * 永远命中同一 id → upsert 覆盖写天然幂等。
 */

export interface VectorPoint {
    id: string;
    vector: number[];
    payload: Record<string, unknown>;
}

export interface StoredPoint {
    id: string;
    payload: Record<string, unknown>;
    vector?: number[];
}

/**
 * vector_id = sha256(f"{repo}:{file_path}:{chunk_index}")（设计 §7.1），
 * Qdrant point id 要求 UUID 字符串，故取前 32 位 hex 格式化为 UUID。
 */
export function pointIdFor(
    repo: string,
    filePath: string,
    chunkIndex: number,
): string {
    const hex = createHash("sha256")
        .update(`${repo}:${filePath}:${chunkIndex}`)
        .digest("hex")
        .slice(0, 32);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** 测试注入用最小接口（QdrantClient 结构化兼容） */
export interface QdrantLike {
    getCollections(): Promise<{ collections: { name: string }[] }>;
    createCollection(name: string, params: unknown): Promise<unknown>;
    createPayloadIndex(name: string, params: unknown): Promise<unknown>;
    upsert(name: string, params: unknown): Promise<unknown>;
    delete(name: string, params: unknown): Promise<unknown>;
    scroll(name: string, params: unknown): Promise<ScrollLikeResponse>;
    deleteCollection(name: string): Promise<unknown>;
}

export interface ScrollLikeResponse {
    points: {
        id: string | number;
        payload?: Record<string, unknown>;
        vector?: unknown;
    }[];
    next_page_offset: unknown;
}

export interface VectorStore {
    /** 幂等建集合（缺失时创建 + payload 索引，已存在则跳过） */
    ensureCollection(collection: string, dimensions: number): Promise<void>;
    upsert(collection: string, points: VectorPoint[]): Promise<void>;
    /** 按 point id 删除（D 文件 / R 旧路径 / M 差集清理） */
    deleteByIds(collection: string, ids: string[]): Promise<void>;
    /** 按 repo 全量删除（仓库下线清理，设计 §9） */
    deleteByRepo(collection: string, repo: string): Promise<void>;
    /** 列出某文件全部点（M 文件旧 chunk 差集清理 / R 向量搬运） */
    listByFilePath(
        collection: string,
        filePath: string,
        withVector: boolean,
    ): Promise<StoredPoint[]>;
    dropCollection(collection: string): Promise<void>;
}

export function createVectorStore(
    qdrantUrl: string,
    apiKey: string | undefined,
    deps: { client?: QdrantLike } = {},
): VectorStore {
    const client: QdrantLike =
        deps.client ??
        (new QdrantClient({ url: qdrantUrl, apiKey }) as unknown as QdrantLike);

    return {
        async ensureCollection(collection, dimensions) {
            const { collections } = await client.getCollections();
            if (!collections.some((c) => c.name === collection)) {
                await client.createCollection(collection, {
                    vectors: { size: dimensions, distance: "Cosine" },
                });
            }
            // payload 索引（幂等：已存在时 Qdrant 报错，忽略）
            for (const field of ["file_path", "repo"]) {
                await client
                    .createPayloadIndex(collection, {
                        field_name: field,
                        field_schema: "keyword",
                    })
                    .catch(() => undefined);
            }
        },

        async upsert(collection, points) {
            if (points.length === 0) return;
            await client.upsert(collection, {
                points: points.map((p) => ({
                    id: p.id,
                    vector: p.vector,
                    payload: p.payload,
                })),
                wait: true,
            });
        },

        async deleteByIds(collection, ids) {
            if (ids.length === 0) return;
            await client.delete(collection, { points: ids, wait: true });
        },

        async deleteByRepo(collection, repo) {
            await client.delete(collection, {
                filter: { must: [{ key: "repo", match: { value: repo } }] },
                wait: true,
            });
        },

        async listByFilePath(collection, filePath, withVector) {
            const points: StoredPoint[] = [];
            let offset: unknown = null;
            do {
                const res = await client.scroll(collection, {
                    filter: {
                        must: [
                            { key: "file_path", match: { value: filePath } },
                        ],
                    },
                    with_payload: true,
                    with_vector: withVector,
                    limit: 100,
                    ...(offset !== null && offset !== undefined
                        ? { offset }
                        : {}),
                });
                for (const p of res.points) {
                    points.push({
                        id: String(p.id),
                        payload: p.payload ?? {},
                        vector: withVector
                            ? (p.vector as number[] | undefined)
                            : undefined,
                    });
                }
                offset = res.next_page_offset;
            } while (offset !== null && offset !== undefined);
            return points;
        },

        async dropCollection(collection) {
            await client.deleteCollection(collection).catch((err: unknown) => {
                if (!String(err).includes("does not exist")) throw err;
            });
        },
    };
}
