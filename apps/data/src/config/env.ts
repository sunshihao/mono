import { z } from "zod";

/**
 * data 服务环境变量（对齐 ingestion 的 env 风格）。
 * 凭据类（QDRANT_*、OPENAI_*、REDIS_URL）不在 env 校验中——它们由
 * sync.config.yaml 的 env:VAR 引用在配置加载时解析（fail-fast）。
 */
export const EnvSchema = z.object({
    PORT: z.coerce.number().int().positive().default(3003),
    DATA_CONFIG_PATH: z.string().default("sync.config.yaml"),
    SYNC_STATE_DIR: z.string().default(".sync-state"),
    REDIS_URL: z.string().url().optional(),
    LOG_LEVEL: z
        .enum(["fatal", "error", "warn", "info", "debug", "trace"])
        .default("info"),
    WORKER_POLL_MS: z.coerce.number().int().positive().default(1000),
    WORKER_LEASE_MS: z.coerce
        .number()
        .int()
        .positive()
        .default(10 * 60_000),
    WORKER_MAX_RETRIES: z.coerce.number().int().nonnegative().default(5),
    /** 对账兜底轮询间隔（设计 §10：防 webhook 丢失） */
    RECONCILE_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),
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
