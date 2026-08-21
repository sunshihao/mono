import { describe, expect, it } from "vitest";
import { HTTPException } from "hono/http-exception";
import { runRagPipeline, type PipelineDeps } from "../src/plugins/llamaindex/pipeline.js";
import { extractText } from "../src/plugins/llamaindex/text.js";

function fakeDeps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
    return {
        embed: async () => [0.1, 0.2, 0.3],
        queryVectors: async () => [
            { score: 0.92, payload: { text: "Agent 以目标为导向自主决策。", file_name: "agent.md", file_path: "data/agent.md" } },
            { score: 0.81, payload: { text: "Workflow 是确定性的流程编排。", file_name: "workflow.md", file_path: "data/workflow.md" } },
        ],
        chat: async (messages) => {
            const user = messages.find((m) => m.role === "user");
            return `回答（资料含 ${(user?.content.match(/资料：/g) ?? []).length} 份）`;
        },
        ...overrides,
    };
}

describe("runRagPipeline", () => {
    it("正常路径：嵌入 → 检索 → 合成，返回 sources 与 provider", async () => {
        const response = await runRagPipeline(fakeDeps(), { query: "Agent 是什么？", topK: 5 });
        expect(response.provider).toBe("llamaindex");
        expect(response.disabled).toBe(false);
        expect(response.answer).toContain("回答");
        expect(response.sources).toHaveLength(2);
        expect(response.sources[0]).toEqual({
            file_path: "data/agent.md",
            file_name: "agent.md",
            score: 0.92,
        });
    });

    it("空结果集：sources 为空，仍合成回答", async () => {
        const response = await runRagPipeline(
            fakeDeps({ queryVectors: async () => [] }),
            { query: "x", topK: 5 },
        );
        expect(response.sources).toEqual([]);
        expect(response.answer).toBeTruthy();
    });

    it("payload 缺失 text/file 字段不崩溃", async () => {
        const response = await runRagPipeline(
            fakeDeps({
                queryVectors: async () => [{ score: 0.5, payload: null }],
            }),
            { query: "x", topK: 5 },
        );
        expect(response.sources[0]).toEqual({ file_path: "", file_name: "", score: 0.5 });
    });

    it("上游失败 → HTTPException 502 retrieval_upstream_failed", async () => {
        await expect(
            runRagPipeline(fakeDeps({ embed: async () => { throw new Error("dashscope 500"); } }), { query: "x", topK: 5 }),
        ).rejects.toSatisfy((err: unknown) => err instanceof HTTPException && err.status === 502);
    });

    it("已抛出的 HTTPException 原样透传", async () => {
        const boom = new HTTPException(503, { message: "unavailable" });
        await expect(
            runRagPipeline(fakeDeps({ embed: async () => { throw boom; } }), { query: "x", topK: 5 }),
        ).rejects.toBe(boom);
    });
});

describe("extractText", () => {
    it("提取纯字符串", () => {
        expect(extractText("直接回答")).toBe("直接回答");
    });

    it("提取 MessageContent 分块数组（type:text）", () => {
        expect(
            extractText([
                { type: "text", text: "第一段" },
                { type: "text", text: "第二段" },
            ]),
        ).toBe("第一段第二段");
    });

    it("混合数组中的字符串元素", () => {
        expect(extractText(["a", { type: "text", text: "b" }, { type: "image" }])).toBe("ab");
    });

    it("未知形态返回空串", () => {
        expect(extractText(42)).toBe("");
        expect(extractText(null)).toBe("");
    });
});
