import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { RunRequestSchema, QueryRequestSchema } from "@repo/types";

/**
 * RAG 工作台 MCP Server（薄协议层）：
 * 把 api 的 HTTP 端点工具化，供 Claude Code / Claude Desktop 等 MCP 客户端
 * 把知识库作为外部数据源消费。数据流：MCP 工具调用 → api HTTP → 检索/编排。
 *
 * 配置（Claude Code）：
 *   claude mcp add rag-workbench -- node <repo>/apps/mcp/dist/index.js
 * 环境变量：API_URL（默认 http://localhost:3000）
 */
const API_URL = process.env.API_URL ?? "http://localhost:3000";

async function callApi<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${API_URL}${path}`, {
        headers: { "content-type": "application/json" },
        ...init,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
        const detail =
            body && typeof body === "object" && "error" in body
                ? String((body as { error: unknown }).error)
                : `HTTP ${res.status}`;
        throw new Error(`api 调用失败（${path}）: ${detail}`);
    }
    return body as T;
}

const server = new McpServer({
    name: "rag-workbench",
    version: "0.1.0",
});

// ---- 工具：纯检索（上下文供给）----
server.registerTool(
    "search_knowledge",
    {
        title: "知识库检索（纯上下文）",
        description:
            "在知识库中检索与问题相关的上下文块（不生成答案）。返回带来源与相似度分数的文本块，适合把工作台知识作为上下文喂给其他 LLM 或直接引用。",
        inputSchema: {
            query: z.string().describe("检索问题或关键词"),
            topK: z.number().int().min(1).max(50).optional().describe("返回块数，默认 5"),
        },
    },
    async ({ query, topK }) => {
        const result = await callApi<{
            query: string;
            results: Array<{
                text: string;
                file_name: string;
                file_path: string;
                doc_hash: string;
                score: number;
            }>;
            provider: string;
            disabled: boolean;
        }>("/v1/retrieval/search", {
            method: "POST",
            body: JSON.stringify({ query, topK: topK ?? 5 }),
        });
        if (result.disabled || result.results.length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: result.disabled
                            ? "检索服务未配置（llamaindex 插件 disabled），无可用结果。"
                            : "未检索到相关内容。",
                    },
                ],
            };
        }
        return {
            content: [
                {
                    type: "text",
                    text: result.results
                        .map(
                            (r, i) =>
                                `[${i + 1}] ${r.file_name}（相似度 ${r.score.toFixed(3)}）\n${r.text}`,
                        )
                        .join("\n\n---\n\n"),
                },
            ],
        };
    },
);

// ---- 工具：完整 RAG 问答（带合成答案）----
server.registerTool(
    "rag_query",
    {
        title: "知识库问答（带合成答案）",
        description:
            "对知识库提问并返回 LLM 合成的答案与引用来源（qwen-plus 基于检索上下文作答）。",
        inputSchema: {
            query: z.string().describe("要回答的问题"),
            topK: z.number().int().min(1).max(50).optional().describe("检索块数，默认 5"),
        },
    },
    async ({ query, topK }) => {
        const body = QueryRequestSchema.parse({ query, topK });
        const result = await callApi<{
            answer: string | null;
            sources: Array<{ file_name: string; score?: number }>;
            provider: string;
            disabled: boolean;
        }>("/v1/retrieval/query", {
            method: "POST",
            body: JSON.stringify(body),
        });
        const sources = result.sources
            .map((s) => `${s.file_name}${s.score !== undefined ? `（${s.score.toFixed(3)}）` : ""}`)
            .join("、");
        return {
            content: [
                {
                    type: "text",
                    text:
                        result.answer ??
                        (result.disabled
                            ? "检索服务未配置，无答案。"
                            : "未能生成答案。") +
                            (sources ? `\n\n来源：${sources}` : ""),
                },
            ],
        };
    },
);

// ---- 工具：工作流列表 ----
server.registerTool(
    "list_workflows",
    {
        title: "工作流列表",
        description: "列出数据库中保存的编排工作流（id/名称/版本/节点数）。",
        inputSchema: {},
    },
    async () => {
        const result = await callApi<{
            workflows: Array<{ id: string; name: string; version: number; graph: { nodes: unknown[] } }>;
        }>("/v1/workflows");
        if (result.workflows.length === 0) {
            return { content: [{ type: "text", text: "暂无工作流（db 未配置或为空）。" }] };
        }
        return {
            content: [
                {
                    type: "text",
                    text: result.workflows
                        .map(
                            (w) =>
                                `- ${w.name}（v${w.version}，${w.graph.nodes.length} 节点，id: ${w.id}）`,
                        )
                        .join("\n"),
                },
            ],
        };
    },
);

// ---- 工具：执行工作流 ----
server.registerTool(
    "run_workflow",
    {
        title: "执行工作流",
        description:
            "执行一个已保存的工作流（LangGraph 编译执行：检索/LLM/路由节点）。支持携带前几轮消息做多轮对话。",
        inputSchema: {
            workflowId: z.string().describe("工作流 id（先经 list_workflows 获取）"),
            query: z.string().describe("本轮问题"),
            messages: z
                .array(
                    z.object({
                        role: z.enum(["system", "user", "assistant", "tool"]),
                        content: z.string(),
                    }),
                )
                .optional()
                .describe("历史消息（多轮）"),
        },
    },
    async ({ workflowId, query, messages }) => {
        const body = RunRequestSchema.parse({ query, messages });
        const result = await callApi<{
            messages: Array<{ role: string; content: string }>;
        }>(`/v1/workflows/${workflowId}/run`, {
            method: "POST",
            body: JSON.stringify(body),
        });
        const last = result.messages[result.messages.length - 1];
        return {
            content: [
                {
                    type: "text",
                    text: last ? last.content : "工作流执行完成（无输出消息）。",
                },
            ],
        };
    },
);

const transport = new StdioServerTransport();
await server.connect(transport);
// stdio 模式：stderr 可安全用于日志（stdout 是协议通道）
console.error(`rag-workbench MCP server 已启动（API: ${API_URL}）`);
