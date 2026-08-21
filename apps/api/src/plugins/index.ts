import type { Plugin } from "./types.js";
import { redisPlugin } from "./redis/index.js";
import { dbPlugin } from "./db/index.js";
import { qdrantPlugin } from "./qdrant/index.js";
import { observabilityPlugin } from "./observability/index.js";
import { langgraphPlugin } from "./langgraph/index.js";
import { llamaindexPlugin } from "./llamaindex/index.js";

/**
 * 全部插件。数组顺序即"无依赖插件之间"的初始化顺序（有依赖的按 deps 拓扑排序）。
 * 新增集成：在 plugins/<name>/ 下实现 Plugin 契约，然后在这里注册。
 */
export const plugins: Plugin[] = [
  redisPlugin,
  dbPlugin,
  qdrantPlugin,
  observabilityPlugin,
  langgraphPlugin,
  llamaindexPlugin,
];

export type { Plugin, PluginInitContext, PluginResult } from "./types.js";
export { PluginRegistry } from "./registry.js";
