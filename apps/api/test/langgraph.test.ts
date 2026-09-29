import { beforeEach, describe, expect, it } from "vitest";
import type { QueryRequest, QueryResponse, WorkflowGraph } from "@repo/types";
import { MemorySaver } from "@langchain/langgraph";
import { compileGraph } from "../src/plugins/langgraph/compiler.js";
import { langgraphPlugin } from "../src/plugins/langgraph/index.js";
import type { PluginInitContext } from "../src/plugins/types.js";
import type { LlamaIndexService, Services } from "../src/types.js";

/** retrieve 节点传给管线的最后一次入参（断言 config 是否真的生效） */
let lastQuery: QueryRequest | undefined;
beforeEach(() => {
    lastQuery = undefined;
});

const fakeLlm: LlamaIndexService = {
    chat: async (messages) => `LLM 回复（${messages.length} 条消息）`,
    query: async (input): Promise<QueryResponse> => {
        lastQuery = input;
        return {
            query: input.query,
            answer: "检索答案",
            sources: [{ file_name: "a.md", file_path: "p/a.md", score: 0.9 }],
            provider: "llamaindex",
            disabled: false,
        };
    },
    search: async (input) => ({
        query: input.query,
        results: [],
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

/** start→retrieve→end（retrieve 的 config 由用例给定） */
function retrieveGraph(config: Record<string, unknown>): WorkflowGraph {
    return {
        nodes: [
            { id: "s", type: "start", config: {} },
            { id: "ret", type: "retrieve", config },
            { id: "e", type: "end", config: {} },
        ],
        edges: [
            { id: "e1", source: "s", target: "ret" },
            { id: "e2", source: "ret", target: "e" },
        ],
    };
}

const SKILL_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const MCP_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";

describe("retrieve 节点的 config 生效（知识库问答参数进工作流）", () => {
    it("config.topK 透传给检索管线（不再是硬编码 5）", async () => {
        const compiled = compileGraph(retrieveGraph({ topK: 20 }), fakeLlm);
        await compiled.invoke({
            messages: [{ role: "user", content: "问题" }],
        });
        expect(lastQuery?.topK).toBe(20);
    });

    it("config.skillId / mcpToolId 原样透传", async () => {
        const compiled = compileGraph(
            retrieveGraph({ skillId: SKILL_ID, mcpToolId: MCP_ID }),
            fakeLlm,
        );
        await compiled.invoke({
            messages: [{ role: "user", content: "问题" }],
        });
        expect(lastQuery?.skillId).toBe(SKILL_ID);
        expect(lastQuery?.mcpToolId).toBe(MCP_ID);
    });

    it("无 config 时退回默认 topK=5（既有图行为不变）", async () => {
        const compiled = compileGraph(retrieveGraph({}), fakeLlm);
        await compiled.invoke({
            messages: [{ role: "user", content: "问题" }],
        });
        expect(lastQuery?.topK).toBe(5);
        expect(lastQuery?.skillId).toBeUndefined();
        expect(lastQuery?.mcpToolId).toBeUndefined();
    });

    it("字符串数字被 coerce（手改过的图可能存字符串）", async () => {
        const compiled = compileGraph(retrieveGraph({ topK: "12" }), fakeLlm);
        await compiled.invoke({
            messages: [{ role: "user", content: "问题" }],
        });
        expect(lastQuery?.topK).toBe(12);
    });

    it("非法 config 整体退回默认且不抛（软失败，不该让整次运行 500）", async () => {
        const bads: Record<string, unknown>[] = [
            { topK: 999 },
            { topK: 0 },
            { topK: "abc" },
            { topK: null },
            { topK: 3.5 },
        ];
        for (const bad of bads) {
            const compiled = compileGraph(retrieveGraph(bad), fakeLlm);
            await compiled.invoke({
                messages: [{ role: "user", content: "问题" }],
            });
            expect(lastQuery?.topK, `config=${JSON.stringify(bad)}`).toBe(5);
        }
    });
});

/**
 * 用假 ctx 走一次**插件层**的 run —— 执行轨迹（trace）是在插件的 run 里组装的
 * （compileGraph 只返回终态），故这些用例必须打插件而不是 compiler。
 */
async function runViaPlugin(graph: WorkflowGraph, query: string) {
    const services = {
        redis: null,
        db: null,
        qdrant: null,
        observability: null,
        langgraph: null,
        llamaindex: fakeLlm,
    } as Services;
    const ctx: PluginInitContext = {
        cfg: {},
        strict: false,
        onShutdown: () => {},
        getServices: () => services,
    };
    const service = await langgraphPlugin.init(ctx);
    if ("disabled" in service) throw new Error("langgraph 插件意外 disabled");
    return service.run(graph, query);
}

describe("执行轨迹（查看执行结果）", () => {
    it("按实际执行顺序记录每个节点", async () => {
        const out = await runViaPlugin(retrieveGraph({ topK: 5 }), "问题");
        expect(out.trace.map((s) => s.nodeId)).toEqual(["s", "ret", "e"]);
        expect(out.trace.map((s) => s.type)).toEqual([
            "start",
            "retrieve",
            "end",
        ]);
    });

    it("直通节点（start/end）无输出，retrieve 带自己的消息", async () => {
        const out = await runViaPlugin(retrieveGraph({ topK: 5 }), "问题");
        const [start, retrieve, end] = out.trace;
        expect(start?.messages).toEqual([]);
        expect(end?.messages).toEqual([]);
        expect(retrieve?.messages).toHaveLength(1);
        expect(retrieve?.messages[0]?.content).toContain("检索答案");
    });

    it("router 图：轨迹只含实际走到的分支", async () => {
        // run() 不接受 route，路由键取 state.route ?? currentChannel，
        // 而 currentChannel 默认 "retrieval" → 走 ret 分支，chat 不应出现。
        const out = await runViaPlugin(routerGraph, "问题");
        expect(out.trace.map((s) => s.nodeId)).toEqual(["s", "r", "ret", "e"]);
        expect(out.trace.some((s) => s.nodeId === "chat")).toBe(false);
    });

    it("回归护栏：换成 stream 后 messages 与改动前逐字一致", async () => {
        const out = await runViaPlugin(retrieveGraph({ topK: 5 }), "问题");
        expect(out.messages).toEqual([
            { role: "user", content: "问题" },
            {
                role: "assistant",
                content: "检索答案\n（来源：a.md）",
            },
        ]);
        // currentChannel 仍由 StateAnnotation 的默认值给出
        expect(out.currentChannel).toBe("retrieval");
    });
});
