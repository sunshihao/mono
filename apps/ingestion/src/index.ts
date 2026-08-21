import { serve } from "@hono/node-server";
import { Redis } from "ioredis";
import { env } from "./config/env.js";
import { createLogger } from "./lib/logger.js";
import { startPoller } from "./poll.js";
import { createStreamClient } from "./stream.js";
import { startWatcher } from "./watch.js";
import { createWebhookApp } from "./webhook.js";

/**
 * ingestion-service：长驻 Node 进程（非 Edge 部署）。
 * 三来源统一写入 ioredis Stream（XADD）：
 *   1. chokidar 文件监听（INGEST_DIR）
 *   2. Hono webhook 路由（SaaS 数据源推送）
 *   3. 定时轮询兜底（旧系统 Hash 比对）
 */
const logger = createLogger(env.LOG_LEVEL);

const redis = env.REDIS_URL
    ? new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 })
    : null;
if (!env.REDIS_URL) {
    logger.warn("REDIS_URL not set: XADD will be skipped (webhooks still return 202 envelopes)");
}
const stream = createStreamClient(redis, logger);

let watcher = null;
let poller = null;
if (env.INGEST_DIR) {
    watcher = await startWatcher(env.INGEST_DIR, stream, logger);
    poller = startPoller(env.INGEST_DIR, env.POLL_INTERVAL_MS, stream, logger);
} else {
    logger.warn("INGEST_DIR not set: fs watcher and poller disabled");
}

const app = createWebhookApp(stream);
const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    logger.info(`ingestion-service listening on http://localhost:${info.port}`);
});

let shuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down");
    server.close();
    await watcher?.close();
    poller?.stop();
    await redis?.quit().catch(() => undefined);
    process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
