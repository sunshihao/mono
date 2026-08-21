import { Redis } from "ioredis";
import { z } from "zod";
import type { RedisService } from "../../types.js";
import type { Plugin } from "../types.js";

const ConfigSchema = z.object({
  REDIS_URL: z.string().url(),
});
type Config = z.infer<typeof ConfigSchema>;

/**
 * ioredis：缓存 / PubSub / Streams（未来 ingestion 队列的消费端）。
 * lazyConnect：启动不建连，首次命令才连接 —— 配置了但连不上不会阻塞启动，
 * 只会让 /readyz 报 error。
 */
export const redisPlugin: Plugin<RedisService> = {
  name: "redis",
  version: "0.1.0",
  configSchema: ConfigSchema,
  async init(ctx) {
    const { REDIS_URL } = ctx.cfg as Config;
    const client = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
    ctx.onShutdown(async () => {
      await client.quit().catch(() => undefined);
    });
    return { client };
  },
  async health(service) {
    try {
      await service.client.ping();
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : "PING failed" };
    }
  },
};
