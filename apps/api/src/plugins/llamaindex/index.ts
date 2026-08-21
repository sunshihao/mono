import { Settings } from "llamaindex";
import { OpenAI, OpenAIEmbedding } from "@llamaindex/openai";
import { z } from "zod";
import {
    RAG_COLLECTION,
    RAG_VECTOR_NAME,
    type AgentMessage,
} from "@repo/types";
import type { LlamaIndexService } from "../../types.js";
import type { Plugin } from "../types.js";
import { runRagPipeline, type RetrievedPoint } from "./pipeline.js";
import { extractText } from "./text.js";

const ConfigSchema = z.object({
    OPENAI_API_KEY: z.string().min(1),
    /** 默认 OpenAI；DashScope 兼容端点见 apps/api/.env.example */
    OPENAI_BASE_URL: z.string().url().optional(),
});
type Config = z.infer<typeof ConfigSchema>;

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
 */
export const llamaindexPlugin: Plugin<LlamaIndexService> = {
    name: "llamaindex",
    version: "0.2.0",
    deps: ["qdrant"],
    configSchema: ConfigSchema,
    async init(ctx) {
        const { OPENAI_API_KEY, OPENAI_BASE_URL } = ctx.cfg as Config;
        const qdrant = ctx.getServices().qdrant;
        if (!qdrant) {
            return {
                disabled: true,
                reason: "qdrant plugin not configured (required for retrieval)",
            };
        }
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
            const response = await llm.chat({
                messages: messages.map((m) => ({
                    role: mapRole(m.role),
                    content: m.content,
                })),
            });
            return extractText(response.message.content);
        };

        return {
            chat,
            query: (input) =>
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
                ),
        };
    },
};
