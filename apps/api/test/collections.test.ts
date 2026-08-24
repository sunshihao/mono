import { describe, expect, it } from "vitest";
import {
    collectionsId,
    parseCollections,
    queryAcrossCollections,
    type CollectionQuerier,
} from "../src/plugins/llamaindex/collections.js";

describe("parseCollections", () => {
    it("name@vectorName 与未命名条目混合解析", () => {
        expect(
            parseCollections(
                "knowledgeOfAI@text-embedding-v4, chinese-buy-us-stock-guide-main",
            ),
        ).toEqual([
            { name: "knowledgeOfAI", vectorName: "text-embedding-v4" },
            { name: "chinese-buy-us-stock-guide-main" },
        ]);
    });

    it("空白容错，空段忽略", () => {
        expect(parseCollections(" a ,, b@v ")).toEqual([
            { name: "a" },
            { name: "b", vectorName: "v" },
        ]);
    });

    it("非法条目 → 抛错（fail-fast）", () => {
        expect(() => parseCollections("a@")).toThrow(/invalid RAG_SEARCH_COLLECTIONS/);
        expect(() => parseCollections("@v")).toThrow(/invalid RAG_SEARCH_COLLECTIONS/);
    });
});

describe("collectionsId", () => {
    it("稳定序列化且与顺序无关", () => {
        const a = collectionsId([
            { name: "b" },
            { name: "a", vectorName: "v" },
        ]);
        const b = collectionsId([
            { name: "a", vectorName: "v" },
            { name: "b" },
        ]);
        expect(a).toBe(b);
        expect(a).toBe("a@v,b");
    });
});

describe("queryAcrossCollections", () => {
    function fakeQuerier(map: Record<string, { score: number; payload?: unknown }[]>) {
        const calls: [string, { using?: string; limit: number }][] = [];
        const querier: CollectionQuerier = async (collection, params) => {
            calls.push([collection, { using: params.using, limit: params.limit }]);
            const points = map[collection];
            if (points === undefined) {
                throw new Error(`collection ${collection} not found`);
            }
            return { points };
        };
        return { querier, calls };
    }

    it("多集合合并：score 降序取 topK", async () => {
        const { querier } = fakeQuerier({
            a: [
                { score: 0.5, payload: { text: "a1" } },
                { score: 0.9, payload: { text: "a2" } },
            ],
            b: [{ score: 0.7, payload: { text: "b1" } }],
        });
        const points = await queryAcrossCollections(
            querier,
            [{ name: "a" }, { name: "b" }],
            [0.1, 0.2],
            2,
        );
        expect(points.map((p) => p.score)).toEqual([0.9, 0.7]);
        expect(points[0]!.payload).toEqual({ text: "a2" });
    });

    it("命名向量集合传 using，未命名不传", async () => {
        const { querier, calls } = fakeQuerier({ a: [], b: [] });
        await queryAcrossCollections(
            querier,
            [{ name: "a", vectorName: "v" }, { name: "b" }],
            [0.1],
            3,
        );
        expect(calls).toEqual([
            ["a", { using: "v", limit: 3 }],
            ["b", { using: undefined, limit: 3 }],
        ]);
    });

    it("单集合失败（集合未创建）→ warn 跳过，其余正常", async () => {
        const { querier } = fakeQuerier({
            ok: [{ score: 0.8, payload: { text: "ok" } }],
        });
        const points = await queryAcrossCollections(
            querier,
            [{ name: "missing" }, { name: "ok" }],
            [0.1],
            3,
        );
        expect(points).toHaveLength(1);
        expect(points[0]!.score).toBe(0.8);
    });

    it("全部失败 → 抛错（pipeline 侧包装为 502）", async () => {
        const { querier } = fakeQuerier({});
        await expect(
            queryAcrossCollections(querier, [{ name: "missing" }], [0.1], 3),
        ).rejects.toThrow(/not found/);
    });

    it("空清单 → 空结果（不调用查询器）", async () => {
        const { querier, calls } = fakeQuerier({});
        await expect(
            queryAcrossCollections(querier, [], [0.1], 3),
        ).resolves.toEqual([]);
        expect(calls).toHaveLength(0);
    });
});
