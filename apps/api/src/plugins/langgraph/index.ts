import { MemorySaver } from "@langchain/langgraph";
import { z } from "zod";
import type { AgentMessage, AgentState } from "@repo/types";
import { ConfigError } from "../../lib/errors.js";
import type { LangGraphService } from "../../types.js";
import type { Plugin } from "../types.js";
import { compileGraph } from "./compiler.js";

/** 无外部配置，始终可用（内存态；llm/retrieve 节点运行时才要求 llamaindex 插件就绪） */
const ConfigSchema = z.object({});

/**
 * LangGraph.js 编排引擎：把 @repo/types 的 WorkflowGraph（nodes/edges）
 * 编译为可执行图（节点映射与 router 约定见 compiler.ts）。
 * 里程碑 4：MemorySaver checkpointer（thread 级状态持久化）+ 多轮历史重放。
 */
export const langgraphPlugin: Plugin<LangGraphService> = {
    name: "langgraph",
    version: "0.3.0",
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
        // 进程内共享 checkpointer：thread_id 相同的 run 可续跑
        const checkpointer = new MemorySaver();

        return {
            compile: (graph) =>
                compileGraph(graph, requireLlm(), { checkpointer }),
            run: async (graph, query, history = []) => {
                const compiled = compileGraph(graph, requireLlm(), {
                    checkpointer,
                });
                const messages: AgentMessage[] = [
                    ...history,
                    { role: "user", content: query },
                ];
                const state = await compiled.invoke(
                    { messages },
                    {
                        configurable: {
                            // 每次 run 独立 thread；同一 thread_id 可经 checkpointer 续跑
                            thread_id: crypto.randomUUID(),
                        },
                    },
                );
                return state as unknown as AgentState;
            },
        };
    },
};
