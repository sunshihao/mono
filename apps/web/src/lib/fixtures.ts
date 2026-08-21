import type { WorkflowGraph } from "@repo/types";

/**
 * 内置示例工作流：本地无 PostgreSQL（db 插件 disabled）时用于浏览画布。
 * 图结构与 @repo/types 的 WorkflowGraph / langgraph 编译器约定一致
 * （router 出边 condition = 路由键）。
 */
export interface SampleWorkflow {
    id: string;
    name: string;
    description: string;
    graph: WorkflowGraph;
}

export const sampleWorkflows: SampleWorkflow[] = [
    {
        id: "sample-rag",
        name: "知识问答（RAG）",
        description: "检索增强生成：先检索知识库，再回答问题",
        graph: {
            nodes: [
                { id: "start", type: "start", config: {} },
                { id: "retrieve", type: "retrieve", label: "检索", config: { topK: 5 } },
                { id: "end", type: "end", config: {} },
            ],
            edges: [
                { id: "e1", source: "start", target: "retrieve" },
                { id: "e2", source: "retrieve", target: "end" },
            ],
        },
    },
    {
        id: "sample-router",
        name: "意图路由问答",
        description: "按意图分流：知识问题走检索，闲聊走 LLM 直答",
        graph: {
            nodes: [
                { id: "start", type: "start", config: {} },
                { id: "router", type: "router", label: "意图路由", config: {} },
                { id: "retrieve", type: "retrieve", label: "检索", config: { topK: 5 } },
                { id: "chat", type: "llm", label: "对话", config: { model: "qwen-plus" } },
                { id: "end", type: "end", config: {} },
            ],
            edges: [
                { id: "e1", source: "start", target: "router" },
                { id: "e2", source: "router", target: "retrieve", condition: "retrieval" },
                { id: "e3", source: "router", target: "chat", condition: "chat" },
                { id: "e4", source: "retrieve", target: "end" },
                { id: "e5", source: "chat", target: "end" },
            ],
        },
    },
    {
        id: "sample-direct",
        name: "直接对话",
        description: "无检索，LLM 直接回答",
        graph: {
            nodes: [
                { id: "start", type: "start", config: {} },
                { id: "chat", type: "llm", label: "对话", config: { model: "qwen-plus" } },
                { id: "end", type: "end", config: {} },
            ],
            edges: [
                { id: "e1", source: "start", target: "chat" },
                { id: "e2", source: "chat", target: "end" },
            ],
        },
    },
];
