import { serve } from "@hono/node-server";
import { resolve } from "node:path";
import type { Hono } from "hono";
import type { DataContext } from "./context.js";
import { createGitOps } from "./git.js";
import { createQueue, createRedisKv, createRedisStream } from "./queue.js";
import { startReconcile } from "./reconcile.js";
import { createStateStore } from "./state.js";
import { createSyncService } from "./sync.js";
import { createWebhookApp } from "./webhook.js";
import { startWorker } from "./worker.js";

/**
 * 一体化 serve（设计 §4 架构的落位）：webhook receiver + sync worker
 * + 定时对账 三组件同进程（也可经 CLI 单组件启动）。
 * redis 未配置 → worker/对账禁用，webhook 对 push 返回 503（fail-safe）。
 */

export function buildWebhookApp(ctx: DataContext): Hono {
    const queue = createQueue(ctx.redis, ctx.logger);
    const kv = createRedisKv(ctx.redis);
    return createWebhookApp({
        config: ctx.config,
        queue,
        kv,
        logger: ctx.logger,
        redisAvailable: Boolean(ctx.redis),
    });
}

/** 返回停机函数（close server / stop worker+reconcile / quit redis） */
export async function startServe(ctx: DataContext): Promise<() => Promise<void>> {
    const { env, config, logger, baseDir, redis } = ctx;
    const syncService = createSyncService(config, {
        logger,
        baseDir,
        stateDir: env.SYNC_STATE_DIR,
    });

    const server = serve({ fetch: buildWebhookApp(ctx).fetch, port: env.PORT }, (info) => {
        logger.info(`data-service listening on http://localhost:${info.port}`);
    });

    const stops: (() => void)[] = [];
    if (redis) {
        const queue = createQueue(redis, logger);
        const kv = createRedisKv(redis);
        stops.push(
            startWorker(
                {
                    config,
                    stream: createRedisStream(redis),
                    kv,
                    queue,
                    syncService,
                    logger,
                },
                {
                    pollIntervalMs: env.WORKER_POLL_MS,
                    leaseMs: env.WORKER_LEASE_MS,
                    maxRetries: env.WORKER_MAX_RETRIES,
                },
            ).stop,
        );
        stops.push(
            startReconcile(
                config,
                baseDir,
                {
                    git: createGitOps(),
                    state: createStateStore(resolve(baseDir, env.SYNC_STATE_DIR), logger),
                    kv,
                    queue,
                    logger,
                },
                env.RECONCILE_INTERVAL_MS,
            ).stop,
        );
    } else {
        logger.error(
            "REDIS_URL not set: worker and reconcile disabled; webhook rejects pushes (503)",
        );
    }

    return async () => {
        for (const stop of stops) stop();
        server.close();
        await redis?.quit().catch(() => undefined);
    };
}
