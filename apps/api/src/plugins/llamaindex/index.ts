import { createHash } from "node:crypto";
import { Settings } from "llamaindex";
import { OpenAI, OpenAIEmbedding } from "@llamaindex/openai";
import { trace } from "@opentelemetry/api";
import { z } from "zod";
import {
    QueryResponseSchema,
    SearchResponseSchema,
    type AgentMessage,
    type QueryRequest,
    type QueryResponse,
    type SearchResponse,
} from "@repo/types";
import type { LlamaIndexService } from "../../types.js";
import type { Plugin } from "../types.js";
import { createLogger } from "../../lib/logger.js";
import {
    collectionsId,
    parseCollections,
    queryAcrossCollections,
} from "./collections.js";
import {
    runRagPipeline,
    runRagSearch,
    type RetrievedPoint,
} from "./pipeline.js";
import { extractText } from "./text.js";

const llmTracer = trace.getTracer("@repo/api/llm");

const ConfigSchema = z.object({
    OPENAI_API_KEY: z.string().min(1),
    /** 默认 OpenAI；DashScope 兼容端点见 apps/api/.env.example */
    OPENAI_BASE_URL: z.string().url().optional(),
    /** 检索响应缓存 TTL（秒）；0 = 禁用缓存 */
    RAG_CACHE_TTL: z.coerce.number().int().nonnegative().default(300),
    /**
     * 检索集合清单：`name[@vectorName]` 逗号分隔。
     * 带 @ 前缀后缀 = 命名向量集合（knowledgeOfAI@text-embedding-v4）；
     * 不带 = 未命名单向量集合（apps/data 同步系统的 per-repo 集合）。
     */
    RAG_SEARCH_COLLECTIONS: z
        .string()
        .min(1)
        .default("knowledgeOfAI@text-embedding-v4"),
});
type Config = z.infer<typeof ConfigSchema>;

/** 检索缓存键（query+topK+集合清单决定检索结果；TTL 内文档更新可能有陈旧窗口） */
function cacheKey(query: string, topK: number, collections: string): string {
    const digest = createHash("sha256")
        .update(`${query}|${topK}|${collections}`)
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
 *   → Qdrant 多集合检索（依赖 qdrant 插件；集合清单见 RAG_SEARCH_COLLECTIONS：
 *     knowledgeOfAI 命名向量 + apps/data 同步系统的 per-repo 未命名向量集合）
 *   → qwen-plus LLM 中文合成
 * 配置了 OpenAI 密钥但 qdrant 未配置 → disabled（缺检索后端，管线不成立）。
 * redis 插件就绪时启用检索响应缓存（RAG_CACHE_TTL 秒）。
 */
export const llamaindexPlugin: Plugin<LlamaIndexService> = {
    name: "llamaindex",
    version: "0.4.0",
    deps: ["qdrant", "redis"],
    configSchema: ConfigSchema,
    async init(ctx) {
        const {
            OPENAI_API_KEY,
            OPENAI_BASE_URL,
            RAG_CACHE_TTL,
            RAG_SEARCH_COLLECTIONS,
        } = ctx.cfg as Config;
        const qdrant = ctx.getServices().qdrant;
        if (!qdrant) {
            return {
                disabled: true,
                reason: "qdrant plugin not configured (required for retrieval)",
            };
        }
        // 集合清单语法错误在此 fail-fast（配置错误不降级运行）
        const targets = parseCollections(RAG_SEARCH_COLLECTIONS);
        const targetsId = collectionsId(targets);
        const ragLogger = createLogger(process.env.LOG_LEVEL ?? "info");
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

        /** 多集合查询（query/search 两条管线共用） */
        const queryVectors = async (
            vector: number[],
            topK: number,
        ): Promise<RetrievedPoint[]> =>
            queryAcrossCollections(
                (collection, params) =>
                    qdrant.client.query(collection, {
                        query: params.query,
                        ...(params.using ? { using: params.using } : {}),
                        limit: params.limit,
                        with_payload: params.with_payload,
                    }),
                targets,
                vector,
                topK,
                { logger: ragLogger },
            );

        const pipeline = (input: QueryRequest): Promise<QueryResponse> =>
            runRagPipeline(
                {
                    embed: (text) => embedModel.getTextEmbedding(text),
                    queryVectors,
                    chat,
                },
                input,
            );

        /** 纯检索管线（不合成）：与 query 共用 deps */
        const searchPipeline = (input: QueryRequest): Promise<SearchResponse> =>
            runRagSearch(
                {
                    embed: (text) => embedModel.getTextEmbedding(text),
                    queryVectors,
                    chat,
                },
                input,
            );

        /** 带缓存的检索包装（cache 为 null 或 TTL=0 时直通） */
        const withCache = async <T>(
            prefix: string,
            key: string,
            parse: (raw: string) => { success: boolean; data?: T },
            run: () => Promise<T>,
        ): Promise<T> => {
            if (!cache || RAG_CACHE_TTL === 0) return run();
            const fullKey = `${prefix}${key}`;
            const cached = await cache.client.get(fullKey);
            if (cached) {
                try {
                    const parsed = parse(cached);
                    if (parsed.success && parsed.data !== undefined) {
                        llmTracer
                            .startSpan("rag.cache")
                            .setAttribute("rag.cache.hit", true)
                            .end();
                        return parsed.data;
                    }
                } catch {
                    // 缓存内容损坏：删除并直通
                }
                await cache.client.del(fullKey);
            }
            const result = await run();
            await cache.client
                .setex(fullKey, RAG_CACHE_TTL, JSON.stringify(result))
                .catch(() => undefined); // 缓存失败不影响响应
            return result;
        };

        return {
            chat,
            query: (input) =>
                withCache(
                    "rag:cache:",
                    cacheKey(input.query, input.topK, targetsId),
                    (raw) => QueryResponseSchema.safeParse(JSON.parse(raw)),
                    () => pipeline(input),
                ),
            search: (input) =>
                withCache(
                    "rag:search:",
                    cacheKey(input.query, input.topK, targetsId),
                    (raw) => SearchResponseSchema.safeParse(JSON.parse(raw)),
                    () => searchPipeline(input),
                ),
        };
    },
};
