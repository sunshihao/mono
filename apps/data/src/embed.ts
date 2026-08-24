import { OpenAIEmbedding } from "@llamaindex/openai";
import { withRetry } from "./lib/retry.js";

/**
 * 嵌入器（对齐 ingestion 的 DashScope OpenAI 兼容端点用法）。
 * batch_size 分批 + 指数退避重试（设计 §10：Embedding API 限流/超时）。
 */

export interface Embedder {
    /** 批量嵌入；内部按 batch_size 分批，每批独立退避重试 */
    embedTexts(texts: string[]): Promise<number[][]>;
}

/** 测试注入用最小接口（OpenAIEmbedding 结构化兼容） */
export interface EmbedderLike {
    getTextEmbeddings(texts: string[]): Promise<number[][]>;
}

export interface EmbedderConfig {
    provider: "dashscope" | "openai";
    model: string;
    dimensions: number;
    apiKey: string;
    baseUrl?: string;
    batchSize: number;
}

const DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
/** DashScope text-embedding-v4 单次请求批量上限（超限服务端报 InvalidParameter） */
const DASHSCOPE_MAX_BATCH = 10;

export function createEmbedder(
    config: EmbedderConfig,
    deps: { model?: EmbedderLike } = {},
): Embedder {
    if (!config.apiKey) {
        throw new Error(
            "embedding api_key not configured (env ref resolved empty)",
        );
    }
    const model: EmbedderLike =
        deps.model ??
        new OpenAIEmbedding({
            model: config.model,
            dimensions: config.dimensions,
            apiKey: config.apiKey,
            ...(config.provider === "dashscope"
                ? { baseURL: config.baseUrl ?? DASHSCOPE_BASE_URL }
                : config.baseUrl
                  ? { baseURL: config.baseUrl }
                  : {}),
        });
    // 钳制到 provider 上限，避免配置笔误让整批请求被服务端拒绝
    const batchSize =
        config.provider === "dashscope"
            ? Math.min(config.batchSize, DASHSCOPE_MAX_BATCH)
            : config.batchSize;

    return {
        async embedTexts(texts) {
            const vectors: number[][] = [];
            for (let i = 0; i < texts.length; i += batchSize) {
                const batch = texts.slice(i, i + batchSize);
                const result = await withRetry(
                    () => model.getTextEmbeddings(batch),
                    { retries: 4, baseDelayMs: 1000, maxDelayMs: 30000 },
                );
                vectors.push(...result);
            }
            return vectors;
        },
    };
}
