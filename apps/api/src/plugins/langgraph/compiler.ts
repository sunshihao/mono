import {
    END,
    START,
    StateGraph,
    type BaseCheckpointSaver,
} from "@langchain/langgraph";
import { trace } from "@opentelemetry/api";
import type { AgentMessage, WorkflowGraph, WorkflowNode } from "@repo/types";
import { ConfigError } from "../../lib/errors.js";
import type { LlamaIndexService } from "../../types.js";
import { StateAnnotation } from "./state.js";

type NodeUpdate = { messages?: AgentMessage[] };

const nodeTracer = trace.getTracer("@repo/api/langgraph");

/**
 * 把可序列化的 WorkflowGraph 编译为 LangGraph 可执行图。
 * 节点映射：start→入口、llm→LLM 对话节点、retrieve→检索节点、router→条件边、end→出口。
 * 约定：router 出边的 condition 即 path key（pathMap 另有 "default" 兜底）；
 * 运行时路由键取 state.route ?? state.currentChannel。
 */
export function compileGraph(
    graph: WorkflowGraph,
    llm: LlamaIndexService,
    options: { checkpointer?: BaseCheckpointSaver } = {},
) {
    validateGraph(graph);

    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const startNode = graph.nodes.find((n) => n.type === "start")!;

    // 显式 N=string：节点名是运行时 WorkflowGraph 的字符串 id，无法静态收窄
    const builder = new StateGraph<
        typeof StateAnnotation,
        typeof StateAnnotation.State,
        typeof StateAnnotation.Update,
        string
    >(StateAnnotation);
    for (const node of graph.nodes) {
        builder.addNode(node.id, (state) => nodeAction(node, llm, state));
    }
    builder.addEdge(START, startNode.id);

    const routerNodes = graph.nodes.filter((n) => n.type === "router");
    for (const node of graph.nodes) {
        if (node.type === "end") builder.addEdge(node.id, END);
    }
    for (const edge of graph.edges) {
        const source = byId.get(edge.source)!;
        if (edge.condition && source.type !== "router") {
            throw new ConfigError(
                `edge "${edge.id}": condition only allowed on router out-edges`,
            );
        }
        if (!edge.condition) builder.addEdge(edge.source, edge.target);
    }
    for (const router of routerNodes) {
        const outEdges = graph.edges.filter((e) => e.source === router.id);
        const pathMap: Record<string, string> = {};
        let fallback: string | null = null;
        for (const edge of outEdges) {
            if (edge.condition) pathMap[edge.condition] = edge.target;
            else fallback = edge.target;
        }
        if (fallback) pathMap.default = fallback;
        if (Object.keys(pathMap).length === 0) {
            throw new ConfigError(
                `router node "${router.id}" has no out-edges`,
            );
        }
        builder.addConditionalEdges(
            router.id,
            (state) => {
                const key = state.route ?? state.currentChannel;
                return key in pathMap ? key : "default";
            },
            pathMap,
        );
    }

    return builder.compile({ checkpointer: options.checkpointer });
}

function validateGraph(graph: WorkflowGraph): void {
    const ids = graph.nodes.map((n) => n.id);
    if (new Set(ids).size !== ids.length) {
        throw new ConfigError("workflow graph has duplicate node ids");
    }
    const starts = graph.nodes.filter((n) => n.type === "start");
    if (starts.length !== 1) {
        throw new ConfigError(
            "workflow graph must have exactly one start node",
        );
    }
    if (!graph.nodes.some((n) => n.type === "end")) {
        throw new ConfigError("workflow graph must have at least one end node");
    }
    for (const edge of graph.edges) {
        if (!byIds(graph).has(edge.source) || !byIds(graph).has(edge.target)) {
            throw new ConfigError(`edge "${edge.id}" references unknown node`);
        }
    }
}

function byIds(graph: WorkflowGraph): Set<string> {
    return new Set(graph.nodes.map((n) => n.id));
}

/**
 * 节点动作。注意：LangGraph 中带 reducer 的 channel（messages）会把节点返回值
 * 作为 update 交给 reducer —— passthrough 节点必须返回空更新，返回完整 state
 * 会导致消息被 concat 两次。
 * 每个节点执行打一个 span（node id/type/耗时），SDK 未启动时全局 no-op 安全。
 */
async function nodeAction(
    node: WorkflowNode,
    llm: LlamaIndexService,
    state: typeof StateAnnotation.State,
): Promise<NodeUpdate> {
    return nodeTracer.startActiveSpan(
        "langgraph.node",
        {
            attributes: {
                "workflow.node.id": node.id,
                "workflow.node.type": node.type,
                "workflow.node.label": node.label ?? node.type,
                "workflow.messages": state.messages.length,
            },
        },
        async (span) => {
            try {
                return await executeNode(node, llm, state);
            } catch (err) {
                span.recordException(err as Error);
                throw err;
            } finally {
                span.end();
            }
        },
    );
}

async function executeNode(
    node: WorkflowNode,
    llm: LlamaIndexService,
    state: typeof StateAnnotation.State,
): Promise<NodeUpdate> {
    switch (node.type) {
        case "start":
        case "router":
        case "end":
            return {};
        case "llm": {
            const answer = await llm.chat(state.messages);
            return { messages: [{ role: "assistant", content: answer }] };
        }
        case "retrieve": {
            const lastUser = [...state.messages]
                .reverse()
                .find((m) => m.role === "user");
            if (!lastUser) {
                return {
                    messages: [
                        { role: "assistant", content: "没有可检索的问题。" },
                    ],
                };
            }
            const result = await llm.query({
                query: lastUser.content,
                topK: 5,
            });
            const answer = result.answer ?? "未找到相关资料。";
            const sources = result.sources
                .map((s) => s.file_name)
                .filter(Boolean)
                .join("、");
            return {
                messages: [
                    {
                        role: "assistant",
                        content: sources
                            ? `${answer}\n（来源：${sources}）`
                            : answer,
                    },
                ],
            };
        }
    }
}
