import { z } from "zod";
import type { AgentState } from "@repo/types";
import { ConfigError } from "../../lib/errors.js";
import type { LangGraphService } from "../../types.js";
import type { Plugin } from "../types.js";
import { compileGraph } from "./compiler.js";

/** 无外部配置，始终可用（内存态；llm/retrieve 节点运行时才要求 llamaindex 插件就绪） */
const ConfigSchema = z.object({});

/**
 * LangGraph.js 编排引擎：把 @repo/types 的 WorkflowGraph（nodes/edges）
 * 编译为可执行图（节点映射与 router 约定见 compiler.ts）。
 */
export const langgraphPlugin: Plugin<LangGraphService> = {
    name: "langgraph",
    version: "0.2.0",
    configSchema: ConfigSchema,
    async init(ctx) {
        const requireLlm = () => {
            const llamaindex = ctx.getServices().llamaindex;
            if (!llamaindex) {
                throw new ConfigError(
                    "llamaindex plugin not configured (required for llm/retrieve nodes)",
                );
            }
            return llamaindex;
        };
        return {
            compile: (graph) => compileGraph(graph, requireLlm()),
            run: async (graph, query) => {
                const compiled = compileGraph(graph, requireLlm());
                const state = await compiled.invoke({
                    messages: [{ role: "user", content: query }],
                });
                return state as unknown as AgentState;
            },
        };
    },
};
