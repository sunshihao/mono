import { MemorySaver } from "@langchain/langgraph";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { AgentMessage, AgentState } from "@repo/types";
import { ConfigError } from "../../lib/errors.js";
import type { LangGraphService } from "../../types.js";
import type { Plugin } from "../types.js";
import { mcpTools, skills } from "../../db/schema.js";
import { compileGraph, type NodeConfigResolvers } from "./compiler.js";

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

        // skill/mcp 引用节点的解析：查注册表（db 未配置时返回 null → 节点给"不可用"提示）
        const resolvers: NodeConfigResolvers = {
            resolveSkill: async (refId) => {
                const dbService = ctx.getServices().db;
                if (!dbService) return null;
                const [row] = await dbService.db
                    .select({
                        name: skills.name,
                        prompt: skills.prompt,
                        enabled: skills.enabled,
                    })
                    .from(skills)
                    .where(eq(skills.id, refId))
                    .limit(1);
                return row ?? null;
            },
            resolveMcpTool: async (refId) => {
                const dbService = ctx.getServices().db;
                if (!dbService) return null;
                const [row] = await dbService.db
                    .select({
                        name: mcpTools.name,
                        method: mcpTools.method,
                        url: mcpTools.url,
                        enabled: mcpTools.enabled,
                    })
                    .from(mcpTools)
                    .where(eq(mcpTools.id, refId))
                    .limit(1);
                if (!row) return null;
                return {
                    ...row,
                    method: row.method as "GET" | "POST",
                };
            },
        };

        return {
            compile: (graph) =>
                compileGraph(graph, requireLlm(), { checkpointer, resolvers }),
            run: async (graph, query, history = []) => {
                const compiled = compileGraph(graph, requireLlm(), {
                    checkpointer,
                    resolvers,
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
