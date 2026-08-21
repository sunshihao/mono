import { HTTPException } from "hono/http-exception";
import type { AgentMessage, QueryRequest, QueryResponse } from "@repo/types";

/** 检索命中的点（与 Qdrant ScoredPoint 兼容的最小子集） */
export interface RetrievedPoint {
    score: number;
    payload?: Record<string, unknown> | null;
}

/** 管线依赖（纯函数注入，单测用假实现） */
export interface PipelineDeps {
    embed(text: string): Promise<number[]>;
    queryVectors(vector: number[], topK: number): Promise<RetrievedPoint[]>;
    chat(messages: AgentMessage[]): Promise<string>;
}

const SYSTEM_PROMPT =
    "你是知识库问答助手，仅依据用户提供的资料用中文回答；资料不足时明确说明。";

function payloadText(point: RetrievedPoint): string {
    const text = point.payload?.text;
    return typeof text === "string" ? text : "";
}

/**
 * 完整 RAG 管线：嵌入查询 → Qdrant 命名向量检索 → 组装资料 → LLM 合成。
 * 上游（Qdrant / LLM）失败 → HTTPException 502（503 保留给"集成未配置"）。
 */
export async function runRagPipeline(
    deps: PipelineDeps,
    input: QueryRequest,
): Promise<QueryResponse> {
    try {
        const vector = await deps.embed(input.query);
        const points = await deps.queryVectors(vector, input.topK);
        const context = points.map(payloadText).filter(Boolean).join("\n---\n");
        const answer = await deps.chat([
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: `资料：\n${context}\n\n问题：${input.query}` },
        ]);
        return {
            query: input.query,
            answer,
            sources: points.map((p) => ({
                file_path:
                    typeof p.payload?.file_path === "string" ? p.payload.file_path : "",
                file_name:
                    typeof p.payload?.file_name === "string" ? p.payload.file_name : "",
                score: p.score,
            })),
            provider: "llamaindex",
            disabled: false,
        };
    } catch (err) {
        if (err instanceof HTTPException) throw err;
        throw new HTTPException(502, {
            message: `retrieval_upstream_failed: ${err instanceof Error ? err.message : String(err)}`,
        });
    }
}
