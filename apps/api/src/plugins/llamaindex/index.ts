import { createHash } from "node:crypto";
import { Settings } from "llamaindex";
import { OpenAI, OpenAIEmbedding } from "@llamaindex/openai";
import { trace } from "@opentelemetry/api";
import { z } from "zod";
import {
    QueryResponseSchema,
    RAG_COLLECTION,
    RAG_VECTOR_NAME,
    type AgentMessage,
    type QueryRequest,
    type QueryResponse,
} from "@repo/types";
import type { LlamaIndexService } from "../../types.js";
import type { Plugin } from "../types.js";
import { runRagPipeline, type RetrievedPoint } from "./pipeline.js";
import { extractText } from "./text.js";

const llmTracer = trace.getTracer("@repo/api/llm");

const ConfigSchema = z.object({
    OPENAI_API_KEY: z.string().min(1),
    /** 默认 OpenAI；DashScope 兼容端点见 apps/api/.env.example */
    OPENAI_BASE_URL: z.string().url().optional(),
    /** 检索响应缓存 TTL（秒）；0 = 禁用缓存 */
    RAG_CACHE_TTL: z.coerce.number().int().nonnegative().default(300),
});
type Config = z.infer<typeof ConfigSchema>;

/** 检索缓存键（query+topK 决定检索结果；TTL 内文档更新可能有陈旧窗口） */
function cacheKey(query: string, topK: number): string {
    const digest = createHash("sha256")
        .update(`${query}|${topK}`)
        .digest("hex");
    return `rag:cache:${digest}`;
}

/** llamaindex MessageType 无 "tool"：并入对话映射为 "user" */
function mapRole(role: AgentMessage["role"]): "system" | "user" | "assistant" {
    return role === "tool" ? "user" : role;
}

/**
 * LlamaIndexTS 检索 + 索引插件（真实管线）：
 *   嵌入（text-embedding-v4 / 1024 维，DashScope OpenAI 兼容端点）
 *   → Qdrant 命名向量检索（依赖 qdrant 插件，集合 knowledgeOfAI）
 *   → qwen-plus LLM 中文合成
 * 配置了 OpenAI 密钥但 qdrant 未配置 → disabled（缺检索后端，管线不成立）。
 * redis 插件就绪时启用检索响应缓存（RAG_CACHE_TTL 秒）。
 */
export const llamaindexPlugin: Plugin<LlamaIndexService> = {
    name: "llamaindex",
    version: "0.3.0",
    deps: ["qdrant", "redis"],
    configSchema: ConfigSchema,
    async init(ctx) {
        const { OPENAI_API_KEY, OPENAI_BASE_URL, RAG_CACHE_TTL } =
            ctx.cfg as Config;
        const qdrant = ctx.getServices().qdrant;
        if (!qdrant) {
            return {
                disabled: true,
                reason: "qdrant plugin not configured (required for retrieval)",
            };
        }
        // 缓存可选：redis 未配置时直通管线
        const cache = ctx.getServices().redis;
        const baseURL = OPENAI_BASE_URL ?? "https://api.openai.com/v1";

        const llm = new OpenAI({
            model: "qwen-plus",
            apiKey: OPENAI_API_KEY,
            baseURL,
            maxTokens: 4096,
        });
        Settings.llm = llm;

        const embedModel = new OpenAIEmbedding({
            model: "text-embedding-v4",
            dimensions: 1024,
            apiKey: OPENAI_API_KEY,
            baseURL,
        });

        const chat = async (messages: AgentMessage[]): Promise<string> => {
            return llmTracer.startActiveSpan(
                "llm.chat",
                {
                    attributes: {
                        "llm.model": "qwen-plus",
                        "llm.messages": messages.length,
                        "llm.input_chars": messages.reduce(
                            (n, m) => n + m.content.length,
                            0,
                        ),
                    },
                },
                async (span) => {
                    try {
                        const response = await llm.chat({
                            messages: messages.map((m) => ({
                                role: mapRole(m.role),
                                content: m.content,
                            })),
                        });
                        const text = extractText(response.message.content);
                        span.setAttribute("llm.output_chars", text.length);
                        return text;
                    } catch (err) {
                        span.recordException(err as Error);
                        throw err;
                    } finally {
                        span.end();
                    }
                },
            );
        };

        const pipeline = (input: QueryRequest): Promise<QueryResponse> =>
            runRagPipeline(
                {
                    embed: (text) => embedModel.getTextEmbedding(text),
                    queryVectors: async (
                        vector,
                        topK,
                    ): Promise<RetrievedPoint[]> => {
                        const result = await qdrant.client.query(
                            RAG_COLLECTION,
                            {
                                query: vector,
                                using: RAG_VECTOR_NAME,
                                limit: topK,
                                with_payload: true,
                            },
                        );
                        return result.points.map((p) => ({
                            score: p.score,
                            payload: p.payload as
                                Record<string, unknown> | null | undefined,
                        }));
                    },
                    chat,
                },
                input,
            );

        return {
            chat,
            query: async (input): Promise<QueryResponse> => {
                if (!cache || RAG_CACHE_TTL === 0) return pipeline(input);
                const key = cacheKey(input.query, input.topK);
                const cached = await cache.client.get(key);
                if (cached) {
                    const parsed = QueryResponseSchema.safeParse(
                        JSON.parse(cached),
                    );
                    if (parsed.success) {
                        llmTracer
                            .startSpan("rag.cache")
                            .setAttribute("rag.cache.hit", true)
                            .end();
                        return parsed.data;
                    }
                    // 缓存内容损坏：删除并直通
                    await cache.client.del(key);
                }
                const result = await pipeline(input);
                await cache.client
                    .setex(key, RAG_CACHE_TTL, JSON.stringify(result))
                    .catch(() => undefined); // 缓存失败不影响响应
                return result;
            },
        };
    },
};
