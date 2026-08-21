import { Hono } from "hono";
import type { Logger } from "pino";
import type { AppEnv } from "./types.js";
import { createLogger } from "./lib/logger.js";
import { PluginRegistry, type Plugin } from "./plugins/index.js";
import { corsMiddleware } from "./middleware/cors.js";
import { errorHandler } from "./middleware/error-handler.js";
import { requestLogger } from "./middleware/logger.js";
import { requestId } from "./middleware/request-id.js";
import { injectServices } from "./middleware/services.js";
import { mountRoutes } from "./routes/index.js";

export interface CreateAppOptions {
    logger?: Logger;
    /** 严格模式：未配置/初始化失败的集成直接抛 ConfigError */
    strict?: boolean;
    /** 环境变量来源（测试注入用，默认 process.env） */
    env?: NodeJS.ProcessEnv;
}

/** 核心路由 Schema 已累积进类型的 app（AppType/hono-client 依赖） */
export type CoreApp = ReturnType<typeof mountRoutes>;

export interface CreatedApp {
    app: CoreApp;
    registry: PluginRegistry;
    dispose: () => Promise<void>;
}

/**
 * 组合根：注册表启动 → 中间件链 → 核心路由（链式累积 Schema 类型）→ 插件路由。
 * 中间件顺序（有依赖关系）: requestId → requestLogger → cors → services 注入 → onError。
 * 插件路由以副作用挂载（运行时生效），不进入 AppType —— 插件端点属内部接口。
 */
export async function createApp(
    plugins: Plugin[],
    options: CreateAppOptions = {},
): Promise<CreatedApp> {
    const registry = new PluginRegistry(plugins, {
        strict: options.strict,
        env: options.env,
    });
    const { services } = await registry.start();

    const base = new Hono<AppEnv>()
        .use("*", requestId())
        .use(
            "*",
            requestLogger(
                options.logger ?? createLogger(process.env.LOG_LEVEL ?? "info"),
            ),
        )
        .use("*", corsMiddleware())
        .use("*", injectServices(services))
        .onError(errorHandler);

    const app = mountRoutes(base, registry);

    // 插件路由统一挂到 "/"，路径前缀由插件自己的 basePath 决定
    for (const plugin of plugins) {
        const routes = plugin.routes?.(() => services);
        if (routes) app.route("/", routes);
    }

    return { app, registry, dispose: () => registry.dispose() };
}
