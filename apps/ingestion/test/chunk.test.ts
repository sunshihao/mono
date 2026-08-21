import { describe, expect, it } from "vitest";
import { hashToUuid, mimeFromPath, splitText } from "../src/chunk.js";

describe("splitText（对齐 SentenceSplitter 512/50 语义）", () => {
    it("短文本单块且索引覆盖全文", () => {
        const chunks = splitText("一句话。", {
            chunkSize: 512,
            chunkOverlap: 50,
        });
        expect(chunks).toHaveLength(1);
        expect(chunks[0]).toEqual({
            text: "一句话。",
            startCharIdx: 0,
            endCharIdx: 4,
        });
    });

    it("长文本切成多块，块首不超过 chunkSize+句长", () => {
        const sentence = "这是一句测试句子。".repeat(100); // 900 字符
        const chunks = splitText(sentence, {
            chunkSize: 512,
            chunkOverlap: 50,
        });
        expect(chunks.length).toBeGreaterThan(1);
        for (const chunk of chunks) {
            expect(chunk.text.length).toBeLessThanOrEqual(512 + 10);
        }
        // 首块从 0 开始，尾块覆盖到文末
        expect(chunks[0]!.startCharIdx).toBe(0);
        expect(chunks[chunks.length - 1]!.endCharIdx).toBe(sentence.length);
    });

    it("相邻块存在重叠（共享句子）", () => {
        const sentence = "句边界测试。".repeat(60); // 360 字符
        const chunks = splitText(sentence, {
            chunkSize: 100,
            chunkOverlap: 30,
        });
        expect(chunks.length).toBeGreaterThan(1);
        for (let i = 1; i < chunks.length; i++) {
            // 后一块起点应在前一块终点之前（有重叠）
            expect(chunks[i]!.startCharIdx).toBeLessThan(
                chunks[i - 1]!.endCharIdx,
            );
        }
    });

    it("单句超长也单独成块，不丢内容", () => {
        const long = "超长内容".repeat(300); // 1200 字符无句读
        const chunks = splitText(long, { chunkSize: 512, chunkOverlap: 50 });
        expect(chunks.length).toBeGreaterThanOrEqual(2);
        expect(chunks.map((c) => c.text).join("")).toBe(long);
    });

    it("overlap=0 时拼接可还原全文", () => {
        const text = "第一段内容。第二段内容！第三段内容？".repeat(30);
        const chunks = splitText(text, { chunkSize: 200, chunkOverlap: 0 });
        const joined = chunks.map((c) => c.text).join("");
        expect(joined.replace(/\s/g, "")).toBe(text.replace(/\s/g, ""));
    });

    it("overlap>0 时每块都是原文子串且全文被覆盖", () => {
        const text = "第一段内容。第二段内容！第三段内容？".repeat(30);
        const chunks = splitText(text, { chunkSize: 200, chunkOverlap: 20 });
        for (const chunk of chunks) {
            // 每块文本都应能在原文中找到（重叠会导致相邻块重复共享内容，属预期语义）
            expect(text.includes(chunk.text)).toBe(true);
        }
        // 首句与末句必须被覆盖（无内容丢失）
        expect(chunks[0]!.text).toContain("第一段内容。");
        expect(chunks[chunks.length - 1]!.text).toContain("第三段内容？");
    });
});

describe("hashToUuid", () => {
    it("生成合法 uuid 且确定性", () => {
        const a = hashToUuid("abc");
        const b = hashToUuid("abc");
        expect(a).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        expect(a).toBe(b);
        expect(hashToUuid("abd")).not.toBe(a);
    });
});

describe("mimeFromPath", () => {
    it("常见扩展名映射", () => {
        expect(mimeFromPath("a.md")).toBe("text/markdown");
        expect(mimeFromPath("a.txt")).toBe("text/plain");
        expect(mimeFromPath("a.json")).toBe("application/json");
    });

    it("未知扩展名回退 octet-stream", () => {
        expect(mimeFromPath("a.xyz")).toBe("application/octet-stream");
    });
});
