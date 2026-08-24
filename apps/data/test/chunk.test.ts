import { describe, expect, it } from "vitest";
import { chunkText, isBinary, strategyForPath } from "../src/chunk.js";

describe("chunkText", () => {
    it("fixed_size：窗口硬切 + overlap，块不超限", () => {
        const text = "abcdefghijklmnopqrstuvwxyz".repeat(4);
        const chunks = chunkText(text, "fixed_size", 50, 10, "data.txt");
        expect(chunks.length).toBeGreaterThan(1);
        for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(50);
        // overlap：相邻块共享尾部/头部内容
        expect(chunks[1]!.text.slice(0, 10)).toBe(chunks[0]!.text.slice(-10));
    });

    it("markdown_aware：标题开启新段，小块贪心打包", () => {
        const md = ["# A", "short a", "## B", "short b", "# C", "short c"].join(
            "\n",
        );
        // 全部段落合计 < chunk_size → 打包为 1 块
        const packed = chunkText(md, "markdown_aware", 100, 0, "d.md");
        expect(packed).toHaveLength(1);
        expect(packed[0]!.text).toContain("# A");
        expect(packed[0]!.text).toContain("## B");
        expect(packed[0]!.text).toContain("# C");
        // 超过 chunk_size → 在标题边界断开
        const split = chunkText(md, "markdown_aware", 15, 0, "d.md");
        expect(split.length).toBeGreaterThan(1);
        for (const c of split) expect(c.text.length).toBeLessThanOrEqual(15);
    });

    it("markdown_aware：超长段落回退 fixed_size", () => {
        const md = ["# A", "x".repeat(300), "# B", "tail"].join("\n");
        const chunks = chunkText(md, "markdown_aware", 100, 0, "d.md");
        for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(100);
        expect(chunks.some((c) => c.text.startsWith("# B"))).toBe(true);
    });

    it("code_aware：函数/类定义行开启新段，超限在边界断开", () => {
        const code = [
            "import os",
            "",
            "def foo():",
            "    return 1",
            "",
            "class Bar:",
            "    pass",
        ].join("\n");
        // 合计 < chunk_size → 1 块
        expect(chunkText(code, "code_aware", 200, 0, "m.py")).toHaveLength(1);
        // 超限 → 在 def/class 边界断开
        const chunks = chunkText(code, "code_aware", 30, 0, "m.py");
        expect(chunks.length).toBeGreaterThanOrEqual(3);
        expect(chunks[0]!.text).toContain("import os");
        expect(chunks.some((c) => c.text.startsWith("def foo"))).toBe(true);
        expect(chunks.some((c) => c.text.startsWith("class Bar"))).toBe(true);
    });

    it("auto：按扩展名选择策略", () => {
        expect(strategyForPath("a.md", "auto")).toBe("markdown_aware");
        expect(strategyForPath("a.py", "auto")).toBe("code_aware");
        expect(strategyForPath("a.json", "auto")).toBe("fixed_size");
        expect(strategyForPath("a.md", "fixed_size")).toBe("fixed_size");
    });

    it("空/纯空白内容 → 无块", () => {
        expect(chunkText("", "fixed_size", 100, 0, "a.txt")).toEqual([]);
        expect(chunkText("  \n  ", "markdown_aware", 100, 0, "a.md")).toEqual(
            [],
        );
    });

    it("块 index 从 0 连续", () => {
        const text = "word ".repeat(500);
        const chunks = chunkText(text, "fixed_size", 100, 10, "a.txt");
        expect(chunks.map((c) => c.index)).toEqual(
            Array.from({ length: chunks.length }, (_, i) => i),
        );
    });
});

describe("isBinary", () => {
    it("含 NUL → 二进制", () => {
        expect(isBinary(Buffer.from([0x00, 0x61, 0x62]))).toBe(true);
    });
    it("纯文本 → 非二进制", () => {
        expect(isBinary(Buffer.from("hello world"))).toBe(false);
    });
    it("UTF-8 中文 → 非二进制", () => {
        expect(isBinary(Buffer.from("美股指南"))).toBe(false);
    });
});
