import { QdrantClient } from "@qdrant/js-client-rest";
import { RAG_COLLECTION } from "@repo/types";
import { z } from "zod";
import type { QdrantService } from "../../types.js";
import type { Plugin } from "../types.js";

const ConfigSchema = z.object({
  QDRANT_URL: z.string().url(),
  QDRANT_API_KEY: z.string().optional(),
});
type Config = z.infer<typeof ConfigSchema>;

/**
 * Qdrant 向量库客户端（fetch 基，无长连接）。集合与向量配置见 @repo/types 的 RAG_* 常量
 * （对齐 ../RAG 迁移脚本：knowledgeOfAI / text-embedding-v4 / 1024 维 Cosine）。
 */
export const qdrantPlugin: Plugin<QdrantService> = {
  name: "qdrant",
  version: "0.1.0",
  configSchema: ConfigSchema,
  async init(ctx) {
    const { QDRANT_URL, QDRANT_API_KEY } = ctx.cfg as Config;
    const client = new QdrantClient({ url: QDRANT_URL, apiKey: QDRANT_API_KEY });
    return { client };
  },
  async health(service) {
    try {
      await service.client.getCollections();
      // 集合缺失不算故障（索引为空时的合法状态），连通即 ready
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : "getCollections failed" };
    }
  },
};

export { RAG_COLLECTION };
