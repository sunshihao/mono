import type { Hono } from "hono";
import type { z } from "zod";
import type { AppEnv, Services } from "../types.js";

/**
 * 插件契约。核心思想：集成（LangGraph / LlamaIndexTS / Qdrant / Langfuse / Drizzle / Redis）
 * 只是框架的"插件"，生命周期由 PluginRegistry 统一管理：
 *
 *   配置校验（configSchema，zod）→ init（懒连接）→ 挂载路由（routes?）→ dispose（优雅停机）
 *
 * 未配置的插件不阻塞启动，以 { disabled, reason } 降级，状态在 /readyz 可见；
 * STRICT_INTEGRATIONS=true 时未配置的必需插件变为启动报错。
 */
export type PluginResult<S> = S | { disabled: true; reason: string };

export interface PluginInitContext {
    /** configSchema.safeParse(env) 的结果（校验失败不会走到 init） */
    cfg: unknown;
    strict: boolean;
    /** 注册资源回收钩子，dispose 时按注册逆序执行 */
    onShutdown(fn: () => void | Promise<void>): void;
    /**
     * 读取已初始化的插件服务（闭包实时视图）。
     * 按 deps 拓扑排序保证依赖插件先 init；依赖被禁用时为 null，插件可据此降级。
     */
    getServices(): Services;
}

export interface Plugin<S = unknown> {
    /** 必须与 Services 的 key 对应（编译期校验） */
    name: keyof Services;
    version: string;
    /** 依赖的其他插件（初始化前必须就绪），由注册表做 topo 排序 */
    deps?: (keyof Services)[];
    configSchema: z.ZodSchema;
    init(ctx: PluginInitContext): Promise<PluginResult<S>>;
    /** 就绪后的健康检查（/readyz 每次调用；未实现则视为常健康） */
    health?(service: S): Promise<{ ok: boolean; reason?: string }>;
    /**
     * 可选路由子应用，由组合根挂载到 "/"。
     * 用 getter 而非直接注入 services：消除插件路由对注册表启动顺序的依赖。
     * （health/routes 用方法语法声明，保持 Plugin<具体服务> 可赋给 Plugin<unknown> 的双变兼容）
     */
    routes?(getServices: () => Services): Hono<AppEnv>;
}
