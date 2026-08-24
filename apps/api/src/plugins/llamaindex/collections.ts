import { trace } from "@opentelemetry/api";
import type { Logger } from "pino";
import type { RetrievedPoint } from "./pipeline.js";

/**
 * 多集合检索（RAG_SEARCH_COLLECTIONS）。
 *
 * 集合清单语法：`name[@vectorName]`，逗号分隔：
 *  - `knowledgeOfAI@text-embedding-v4`：../RAG 原型集合，命名向量，查询带 using
 *  - `chinese-buy-us-stock-guide-main`：apps/data 同步系统的 per-repo 集合，
 *    未命名单向量，查询不带 using
 *
 * 容错语义：单集合失败（集合未创建/暂不可用）仅 warn 跳过，不影响其余集合；
 * 全部失败才抛错（经 pipeline 包装为 502）。
 */

export interface CollectionTarget {
    name: string;
    /** 命名向量名；undefined = 未命名单向量 */
    vectorName?: string;
}

/** 解析 "name[@vectorName],name,..." → 目标清单；非法条目抛错（fail-fast） */
export function parseCollections(raw: string): CollectionTarget[] {
    return raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => {
            const at = s.indexOf("@");
            if (at === -1) return { name: s };
            const name = s.slice(0, at).trim();
            const vectorName = s.slice(at + 1).trim();
            if (!name || !vectorName) {
                throw new Error(
                    `invalid RAG_SEARCH_COLLECTIONS entry: "${s}" (expected name[@vectorName])`,
                );
            }
            return { name, vectorName };
        });
}

/** targets 的稳定序列化（缓存键用，顺序无关） */
export function collectionsId(targets: CollectionTarget[]): string {
    return targets
        .map((t) => (t.vectorName ? `${t.name}@${t.vectorName}` : t.name))
        .sort()
        .join(",");
}

/** 单集合查询器（qdrant.client.query 的最小结构化子集） */
export interface CollectionQuerier {
    (
        collection: string,
        params: {
            query: number[];
            using?: string;
            limit: number;
            with_payload: boolean;
        },
    ): Promise<{ points: { score: number; payload?: unknown }[] }>;
}

export interface QueryAcrossOptions {
    logger?: Logger;
}

/** 业务埋点 tracer（与 pipeline.ts 同名 tracer，span 嵌套在 rag.search 之下） */
const tracer = trace.getTracer("@repo/api/rag");

/** 逐集合查询 → 按 score 降序合并取 topK */
export async function queryAcrossCollections(
    querier: CollectionQuerier,
    targets: CollectionTarget[],
    vector: number[],
    topK: number,
    options: QueryAcrossOptions = {},
): Promise<RetrievedPoint[]> {
    if (targets.length === 0) return [];

    const points: RetrievedPoint[] = [];
    let failed = 0;
    let lastError: unknown = null;

    for (const target of targets) {
        try {
            const result = await tracer.startActiveSpan(
                "rag.search.collection",
                { attributes: { "rag.collection": target.name } },
                async (span) => {
                    try {
                        const res = await querier(target.name, {
                            query: vector,
                            ...(target.vectorName
                                ? { using: target.vectorName }
                                : {}),
                            limit: topK,
                            with_payload: true,
                        });
                        span.setAttribute("rag.collection.hits", res.points.length);
                        return res;
                    } catch (err) {
                        span.recordException(err as Error);
                        throw err;
                    } finally {
                        span.end();
                    }
                },
            );
            for (const p of result.points) {
                points.push({
                    score: p.score,
                    payload: p.payload as
                        | Record<string, unknown>
                        | null
                        | undefined,
                });
            }
        } catch (err) {
            failed++;
            lastError = err;
            options.logger?.warn(
                { collection: target.name, err },
                "collection query failed, skipped",
            );
        }
    }

    if (failed === targets.length) {
        throw lastError instanceof Error
            ? lastError
            : new Error("all collection queries failed");
    }
    return points.sort((a, b) => b.score - a.score).slice(0, topK);
}
