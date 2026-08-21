import { Settings } from "llamaindex";
import { OpenAI } from "@llamaindex/openai";
import { z } from "zod";
import type { LlamaIndexService } from "../../types.js";
import type { Plugin } from "../types.js";

const ConfigSchema = z.object({
    OPENAI_API_KEY: z.string().min(1),
    /** 默认 OpenAI；DashScope 兼容端点见 apps/api/.env.example */
    OPENAI_BASE_URL: z.string().url().optional(),
});
type Config = z.infer<typeof ConfigSchema>;

/**
 * LlamaIndexTS 检索 + 索引插件。
 * 里程碑 1 只配置 Settings.llm（不发起任何连接）并返回契约形状稳定的占位 query；
 * 里程碑 2 接入 Qdrant 向量库与 text-embedding-v4 嵌入实现真实检索管线。
 */
export const llamaindexPlugin: Plugin<LlamaIndexService> = {
    name: "llamaindex",
    version: "0.1.0",
    configSchema: ConfigSchema,
    async init(ctx) {
        const { OPENAI_API_KEY, OPENAI_BASE_URL } = ctx.cfg as Config;
        Settings.llm = new OpenAI({
            model: "qwen-plus",
            apiKey: OPENAI_API_KEY,
            ...(OPENAI_BASE_URL ? { baseURL: OPENAI_BASE_URL } : {}),
        });
        return {
            query: async (input) => ({
                query: input.query,
                answer: null,
                sources: [],
                provider: "llamaindex",
                disabled: false,
            }),
        };
    },
};
