import { z } from "zod";
import { ConfigError } from "../lib/errors.js";

const booleanFromEnv = z.preprocess((v) => v === "true" || v === "1", z.boolean());

/**
 * 全局环境配置（各集成的环境变量由插件各自的 configSchema 校验）。
 * 严格模式：未配置的必需集成直接启动失败并点名缺失变量。
 */
export const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  STRICT_INTEGRATIONS: booleanFromEnv.default(false),
});
export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new ConfigError(`invalid environment: ${detail}`);
  }
  return parsed.data;
}

export const env = parseEnv();
