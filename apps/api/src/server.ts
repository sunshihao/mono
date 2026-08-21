import { serve } from "@hono/node-server";
import { createApp, type CoreApp } from "./app.js";
import { env } from "./config/env.js";
import { createLogger } from "./lib/logger.js";
import { plugins } from "./plugins/index.js";

export interface RunningServer {
    /** 核心路由 Schema 已累积（AppType/hono-client 依赖） */
    app: CoreApp;
    dispose: () => Promise<void>;
}

/** 引导：构建 app → 监听 → SIGINT/SIGTERM 优雅停机（逆序执行插件 onShutdown） */
export async function startServer(): Promise<RunningServer> {
    const logger = createLogger(env.LOG_LEVEL);
    const { app, dispose } = await createApp(plugins, {
        logger,
        strict: env.STRICT_INTEGRATIONS,
    });

    const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
        logger.info(`api listening on http://localhost:${info.port}`);
    });

    let shuttingDown = false;
    const shutdown = async (signal: string): Promise<void> => {
        if (shuttingDown) return;
        shuttingDown = true;
        logger.info({ signal }, "shutting down");
        server.close();
        await dispose();
        process.exit(0);
    };
    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));

    return { app, dispose };
}
