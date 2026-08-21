import type { Hono } from "hono";
import type { AppEnv } from "../types.js";
import type { PluginRegistry } from "../plugins/registry.js";
import { mountHealth } from "./health.js";
import { mountRetrieval } from "./retrieval.js";
import { mountWorkflows } from "./workflows.js";

/** 核心路由挂载点（插件自身的路由由组合根另行挂载） */
export function mountRoutes(app: Hono<AppEnv>, registry: PluginRegistry): void {
  mountHealth(app, registry);
  mountWorkflows(app);
  mountRetrieval(app);
}
