import type { Hono } from "hono";
import type { AppEnv } from "../types.js";
import type { PluginRegistry } from "../plugins/registry.js";
import { mountHealth } from "./health.js";
import { mountRetrieval } from "./retrieval.js";
import { mountWorkflows } from "./workflows.js";

/**
 * 核心路由挂载点（链式累积 Schema 类型，供 AppType/hono-client 使用；
 * 插件自身的路由由组合根以副作用方式挂载，不进入类型）。
 * 注意：不要给返回类型加注解（会擦除累积的 Schema，AppType 将退化为 BlankSchema）。
 */
export function mountRoutes(app: Hono<AppEnv>, registry: PluginRegistry) {
    return mountRetrieval(mountWorkflows(mountHealth(app, registry)));
}
