import { HTTPException } from "hono/http-exception";
import { SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import type {
    AgentMessage,
    QueryRequest,
    QueryResponse,
    SearchResponse,
} from "@repo/types";

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

/** 附加能力（技能/mcp）解析结果：由插件层查 DB / fetch 得到，管线只负责拼装 */
export interface RagEnhancement {
    skillName?: string;
    skillPrompt?: string;
    mcpName?: string;
    mcpResult?: string;
    warning?: string;
}

/**
 * 业务埋点用的 tracer（SDK 未启动时是全局 no-op，埋点代码无条件安全；
 * LANGFUSE 密钥配好后经 telemetry/init 自动上报）。
 */
const tracer = trace.getTracer("@repo/api/rag");

function payloadText(point: RetrievedPoint): string {
    const text = point.payload?.text;
    return typeof text === "string" ? text : "";
}

/**
 * 完整 RAG 管线：嵌入查询 → Qdrant 命名向量检索 → 组装资料 → LLM 合成。
 * 每个阶段一个子 span（embed/search/synthesize），属性可进 Langfuse 做质量分析。
 * enhance 可选：技能指令注入 system、MCP 工具返回并入上下文（请求携带 skillId/mcpToolId 时由插件层解析）。
 * 上游（Qdrant / LLM）失败 → HTTPException 502（503 保留给"集成未配置"）。
 */
export async function runRagPipeline(
    deps: PipelineDeps,
    input: QueryRequest,
    enhance?: RagEnhancement,
): Promise<QueryResponse> {
    return tracer.startActiveSpan(
        "rag.pipeline",
        {
            attributes: {
                "rag.query": input.query.slice(0, 500),
                "rag.top_k": input.topK,
                ...(enhance?.skillName
                    ? { "rag.skill": enhance.skillName }
                    : {}),
                ...(enhance?.mcpName
                    ? { "rag.mcp_tool": enhance.mcpName }
                    : {}),
            },
        },
        async (span: Span) => {
            try {
                let vector: number[];
                await tracer.startActiveSpan(
                    "rag.embed",
                    async (embedSpan: Span) => {
                        try {
                            vector = await deps.embed(input.query);
                            embedSpan.setAttribute(
                                "rag.embedding.dimensions",
                                vector.length,
                            );
                        } finally {
                            embedSpan.end();
                        }
                    },
                );

                let points: RetrievedPoint[] = [];
                await tracer.startActiveSpan(
                    "rag.search",
                    async (searchSpan: Span) => {
                        try {
                            points = await deps.queryVectors(
                                vector,
                                input.topK,
                            );
                            searchSpan.setAttribute("rag.hits", points.length);
                            searchSpan.setAttribute(
                                "rag.top_score",
                                points[0]?.score ?? 0,
                            );
                        } finally {
                            searchSpan.end();
                        }
                    },
                );

                const context = points
                    .map(payloadText)
                    .filter(Boolean)
                    .join("\n---\n");

                let answer = "";
                await tracer.startActiveSpan(
                    "rag.synthesize",
                    async (synthSpan: Span) => {
                        try {
                            // 技能指令并入 system；MCP 工具返回并入上下文（与检索资料并列）
                            const system = [
                                SYSTEM_PROMPT,
                                ...(enhance?.skillPrompt
                                    ? [`附加技能要求：\n${enhance.skillPrompt}`]
                                    : []),
                            ].join("\n\n");
                            const mcpBlock = enhance?.mcpResult
                                ? `外部工具「${enhance.mcpName}」返回：\n${enhance.mcpResult}\n\n`
                                : "";
                            answer = await deps.chat([
                                { role: "system", content: system },
                                {
                                    role: "user",
                                    content: `${mcpBlock}资料：\n${context}\n\n问题：${input.query}`,
                                },
                            ]);
                            synthSpan.setAttribute(
                                "rag.answer_length",
                                answer.length,
                            );
                            synthSpan.setAttribute(
                                "rag.context_chars",
                                context.length,
                            );
                        } finally {
                            synthSpan.end();
                        }
                    },
                );

                const response: QueryResponse = {
                    query: input.query,
                    answer,
                    sources: points.map((p) => ({
                        file_path:
                            typeof p.payload?.file_path === "string"
                                ? p.payload.file_path
                                : "",
                        file_name:
                            typeof p.payload?.file_name === "string"
                                ? p.payload.file_name
                                : "",
                        score: p.score,
                    })),
                    provider: "llamaindex",
                    disabled: false,
                    // 携带附加能力请求时回显应用情况（无增强不带字段，旧形状稳定）
                    ...(enhance
                        ? {
                              enhancement: {
                                  skillName: enhance.skillName ?? null,
                                  mcpName: enhance.mcpName ?? null,
                                  warning: enhance.warning ?? null,
                              },
                          }
                        : {}),
                };
                span.setAttribute("rag.sources", response.sources.length);
                span.setStatus({ code: SpanStatusCode.OK });
                return response;
            } catch (err) {
                span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: err instanceof Error ? err.message : String(err),
                });
                span.recordException(err as Error);
                if (err instanceof HTTPException) throw err;
                throw new HTTPException(502, {
                    message: `retrieval_upstream_failed: ${err instanceof Error ? err.message : String(err)}`,
                });
            } finally {
                span.end();
            }
        },
    );
}

/**
 * 纯检索管线（外部 LLM / MCP 的上下文供给）：嵌入 → Qdrant 检索，
 * 不做 LLM 合成——由调用方自己的模型消费上下文块。
 * 上游失败 → HTTPException 502（与完整管线同语义）。
 */
export async function runRagSearch(
    deps: PipelineDeps,
    input: QueryRequest,
): Promise<SearchResponse> {
    return tracer.startActiveSpan(
        "rag.search_only",
        {
            attributes: {
                "rag.query": input.query.slice(0, 500),
                "rag.top_k": input.topK,
            },
        },
        async (span: Span) => {
            try {
                const vector = await deps.embed(input.query);
                const points = await deps.queryVectors(vector, input.topK);
                span.setAttribute("rag.hits", points.length);
                const results = points.map((p) => ({
                    text:
                        typeof p.payload?.text === "string"
                            ? p.payload.text
                            : "",
                    file_path:
                        typeof p.payload?.file_path === "string"
                            ? p.payload.file_path
                            : "",
                    file_name:
                        typeof p.payload?.file_name === "string"
                            ? p.payload.file_name
                            : "",
                    doc_hash:
                        typeof p.payload?.doc_hash === "string"
                            ? p.payload.doc_hash
                            : "",
                    score: p.score,
                }));
                span.setStatus({ code: SpanStatusCode.OK });
                return {
                    query: input.query,
                    results,
                    provider: "llamaindex" as const,
                    disabled: false,
                };
            } catch (err) {
                span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: err instanceof Error ? err.message : String(err),
                });
                span.recordException(err as Error);
                if (err instanceof HTTPException) throw err;
                throw new HTTPException(502, {
                    message: `retrieval_upstream_failed: ${err instanceof Error ? err.message : String(err)}`,
                });
            } finally {
                span.end();
            }
        },
    );
}
