import { MemorySaver } from "@langchain/langgraph";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { AgentMessage, AgentState, RunStep } from "@repo/types";
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
                // 用 stream 而非 invoke：invoke 只给终态，看不出逐节点执行顺序、
                // 也看不出 router 实际走了哪个分支。同时订阅两种模式：
                //   updates —— 逐步记录执行轨迹（顺序即实际执行顺序）
                //   values  —— 拿权威终态（不自己按 reducer 重建 state：messages 是
                //              concat、currentChannel/route 是 last-write-wins，重建易错）
                const stream = await compiled.stream(
                    { messages },
                    {
                        configurable: {
                            // 每次 run 独立 thread；同一 thread_id 可经 checkpointer 续跑
                            thread_id: crypto.randomUUID(),
                        },
                        streamMode: ["updates", "values"],
                    },
                );

                const byId = new Map(graph.nodes.map((n) => [n.id, n]));
                const trace: RunStep[] = [];
                let final: AgentState | undefined;

                for await (const chunk of stream) {
                    // 多模式流的块是 [mode, payload] 元组
                    const [mode, payload] = chunk as [string, unknown];
                    if (mode === "updates") {
                        for (const [nodeId, update] of Object.entries(
                            (payload ?? {}) as Record<string, unknown>,
                        )) {
                            const node = byId.get(nodeId);
                            // 跳过 __start__/__interrupt__ 等内部键（不在图节点表里）
                            if (!node) continue;
                            const produced = (
                                update as { messages?: unknown } | null
                            )?.messages;
                            trace.push({
                                nodeId,
                                type: node.type,
                                ...(node.label ? { label: node.label } : {}),
                                messages: Array.isArray(produced)
                                    ? (produced as AgentMessage[])
                                    : [],
                            });
                        }
                    } else if (mode === "values") {
                        final = payload as AgentState;
                    }
                }

                if (!final) {
                    // values 模式必然先吐出输入态，走到这里说明流被中断——宁可响亮失败
                    throw new ConfigError(
                        "langgraph stream ended without a values chunk",
                    );
                }
                return { ...final, trace };
            },
        };
    },
};
