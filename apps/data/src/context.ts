import { resolve } from "node:path";
import { Redis } from "ioredis";
import { loadConfig, type DataConfig } from "./config.js";
import { parseEnv, type Env } from "./config/env.js";
import { createLogger } from "./lib/logger.js";
import type { Logger } from "pino";

/**
 * 进程级组装（cli / serve 共用）：env → logger → 配置 → redis。
 * redis 懒连接：命令触发时才连，未配置为 null（各组件按需降级/拒绝）。
 */
export interface DataContext {
    env: Env;
    config: DataConfig;
    logger: Logger;
    /** local_path / stateDir 的相对基准（默认进程 cwd = apps/data） */
    baseDir: string;
    redis: Redis | null;
}

export function createDataContext(): DataContext {
    const env = parseEnv();
    const logger = createLogger(env.LOG_LEVEL);
    const baseDir = process.cwd();
    const config = loadConfig(resolve(baseDir, env.DATA_CONFIG_PATH));
    const redis = env.REDIS_URL
        ? new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 })
        : null;
    return { env, config, logger, baseDir, redis };
}
