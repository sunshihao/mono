import { describe, expect, it } from "vitest";
import type { QueryResponse, WorkflowGraph } from "@repo/types";
import { MemorySaver } from "@langchain/langgraph";
import { compileGraph } from "../src/plugins/langgraph/compiler.js";
import type { LlamaIndexService } from "../src/types.js";

const fakeLlm: LlamaIndexService = {
    chat: async (messages) => `LLM 回复（${messages.length} 条消息）`,
    query: async (input): Promise<QueryResponse> => ({
        query: input.query,
        answer: "检索答案",
        sources: [{ file_name: "a.md", file_path: "p/a.md", score: 0.9 }],
        provider: "llamaindex",
        disabled: false,
    }),
};

function makeGraph(overrides: Partial<WorkflowGraph> = {}): WorkflowGraph {
    return {
        nodes: [
            { id: "s", type: "start", config: {} },
            { id: "e", type: "end", config: {} },
        ],
        edges: [{ id: "se", source: "s", target: "e" }],
        ...overrides,
    };
}

const routerGraph: WorkflowGraph = {
    nodes: [
        { id: "s", type: "start", config: {} },
        { id: "r", type: "router", config: {} },
        { id: "chat", type: "llm", config: {} },
        { id: "ret", type: "retrieve", config: {} },
        { id: "e", type: "end", config: {} },
    ],
    edges: [
        { id: "e1", source: "s", target: "r" },
        { id: "e2", source: "r", target: "chat", condition: "chat" },
        { id: "e3", source: "r", target: "ret", condition: "retrieval" },
        { id: "e4", source: "chat", target: "e" },
        { id: "e5", source: "ret", target: "e" },
    ],
};

describe("compileGraph 编译", () => {
    it("start→end 直通图：invoke 返回初始用户消息（passthrough 不翻倍）", async () => {
        const compiled = compileGraph(makeGraph(), fakeLlm);
        const state = await compiled.invoke({
            messages: [{ role: "user", content: "你好" }],
        });
        expect(state.messages).toEqual([{ role: "user", content: "你好" }]);
    });

    it("router 按 currentChannel 路由到 retrieve 节点（默认 retrieval）", async () => {
        const compiled = compileGraph(routerGraph, fakeLlm);
        const state = await compiled.invoke({
            messages: [{ role: "user", content: "什么是 RAG？" }],
        });
        expect(state.messages).toHaveLength(2);
        expect(state.messages[1]?.content).toContain("检索答案");
        expect(state.messages[1]?.content).toContain("a.md");
    });

    it("currentChannel=chat 路由到 llm 节点", async () => {
        const compiled = compileGraph(routerGraph, fakeLlm);
        const state = await compiled.invoke({
            messages: [{ role: "user", content: "闲聊" }],
            currentChannel: "chat",
        });
        expect(state.messages[1]?.content).toContain("LLM 回复");
    });

    it("route 优先于 currentChannel", async () => {
        const compiled = compileGraph(routerGraph, fakeLlm);
        const state = await compiled.invoke({
            messages: [{ role: "user", content: "x" }],
            currentChannel: "chat",
            route: "retrieval",
        });
        expect(state.messages[1]?.content).toContain("检索答案");
    });

    it("checkpointer：编译注入 MemorySaver 后 invoke 正常返回", async () => {
        const compiled = compileGraph(makeGraph(), fakeLlm, {
            checkpointer: new MemorySaver(),
        });
        const state = await compiled.invoke(
            { messages: [{ role: "user", content: "你好" }] },
            { configurable: { thread_id: "test-thread" } },
        );
        expect(state.messages).toHaveLength(1);
    });

    it("多轮历史：初始 messages 携带前几轮时，检索节点基于最新用户消息", async () => {
        const compiled = compileGraph(routerGraph, fakeLlm);
        const state = await compiled.invoke({
            messages: [
                { role: "user", content: "第一轮问题" },
                { role: "assistant", content: "第一轮回答" },
                { role: "user", content: "第二轮问题" },
            ],
        });
        // retrieve 节点取最后一条 user 消息（第二轮）生成回答
        expect(state.messages).toHaveLength(4);
        expect(state.messages[3]?.content).toContain("检索答案");
    });
});

describe("compileGraph 校验", () => {
    it("边引用不存在的节点 → ConfigError", () => {
        const graph = makeGraph({
            edges: [{ id: "bad", source: "s", target: "ghost" }],
        });
        expect(() => compileGraph(graph, fakeLlm)).toThrowError(/unknown node/);
    });

    it("非 router 出边带 condition → ConfigError", () => {
        const graph = makeGraph({
            edges: [{ id: "bad", source: "s", target: "e", condition: "chat" }],
        });
        expect(() => compileGraph(graph, fakeLlm)).toThrowError(
            /condition only allowed/,
        );
    });

    it("缺少 start 节点 → ConfigError", () => {
        const graph = makeGraph({
            nodes: [{ id: "e", type: "end", config: {} }],
            edges: [],
        });
        expect(() => compileGraph(graph, fakeLlm)).toThrowError(
            /exactly one start/,
        );
    });

    it("缺少 end 节点 → ConfigError", () => {
        const graph = makeGraph({
            nodes: [{ id: "s", type: "start", config: {} }],
            edges: [],
        });
        expect(() => compileGraph(graph, fakeLlm)).toThrowError(
            /at least one end/,
        );
    });
});
