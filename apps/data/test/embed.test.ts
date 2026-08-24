import { describe, expect, it } from "vitest";
import { createEmbedder } from "../src/embed.js";

function fakeModel() {
    const batches: string[][] = [];
    return {
        batches,
        model: {
            async getTextEmbeddings(texts: string[]) {
                batches.push(texts);
                return texts.map(() => [1, 0, 0]);
            },
        },
    };
}

const BASE = {
    model: "text-embedding-v4",
    dimensions: 1024,
    apiKey: "sk-x",
};

describe("createEmbedder", () => {
    it("dashscope：batch_size 钳制到 10（服务端上限）", async () => {
        const { model, batches } = fakeModel();
        const embedder = createEmbedder(
            { ...BASE, provider: "dashscope", batchSize: 16 },
            { model },
        );
        const texts = Array.from({ length: 25 }, (_, i) => `t${i}`);
        await embedder.embedTexts(texts);
        expect(batches).toHaveLength(3);
        expect(batches.map((b) => b.length)).toEqual([10, 10, 5]);
    });

    it("dashscope：配置值本身 ≤ 10 时不额外切分", async () => {
        const { model, batches } = fakeModel();
        const embedder = createEmbedder(
            { ...BASE, provider: "dashscope", batchSize: 5 },
            { model },
        );
        await embedder.embedTexts(["a", "b", "c", "d", "e", "f"]);
        expect(batches.map((b) => b.length)).toEqual([5, 1]);
    });

    it("openai：不做 dashscope 钳制", async () => {
        const { model, batches } = fakeModel();
        const embedder = createEmbedder(
            { ...BASE, provider: "openai", batchSize: 64 },
            { model },
        );
        await embedder.embedTexts(["a", "b"]);
        expect(batches).toHaveLength(1);
    });

    it("apiKey 缺失 → 抛错", () => {
        expect(() =>
            createEmbedder({ ...BASE, provider: "dashscope", batchSize: 10, apiKey: "" }),
        ).toThrow(/api_key/);
    });
});
