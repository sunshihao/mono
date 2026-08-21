import type { Hono } from "hono";
import type { AppEnv } from "../types.js";
import type { PluginRegistry } from "../plugins/registry.js";

/**
 * 健康检查：
 *  - /healthz 存活（无任何依赖）
 *  - /readyz 就绪：enabled 插件全健康 → 200 ready；有 enabled 插件异常 → 503 degraded。
 *    disabled 插件是"未配置"的预期态而非故障，照常列出但不影响就绪。
 * 链式返回以累积路由 Schema（AppType/hono-client 类型安全依赖它，勿加返回类型注解）。
 */
export function mountHealth(app: Hono<AppEnv>, registry: PluginRegistry) {
    return app
        .get("/healthz", (c) => c.json({ status: "ok" as const }))
        .get("/readyz", async (c) => {
            const plugins = await registry.health();
            const degraded = plugins.some((p) => p.status === "error");
            return c.json(
                { status: degraded ? "degraded" : "ready", plugins },
                degraded ? 503 : 200,
            );
        });
}
