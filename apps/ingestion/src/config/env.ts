import { z } from "zod";

/**
 * ingestion-service 配置。
 * INGEST_DIR 缺省 → fs watcher 与轮询禁用（webhook 仍可用）；
 * REDIS_URL 缺省 → XADD 跳过（仅日志 warn），服务照常启动。
 */
export const EnvSchema = z.object({
    PORT: z.coerce.number().int().positive().default(3002),
    INGEST_DIR: z.string().optional(),
    REDIS_URL: z.string().url().optional(),
    POLL_INTERVAL_MS: z.coerce.number().int().positive().default(60000),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});
export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
    const parsed = EnvSchema.safeParse(source);
    if (!parsed.success) {
        const detail = parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ");
        throw new Error(`invalid environment: ${detail}`);
    }
    return parsed.data;
}

export const env = parseEnv();
