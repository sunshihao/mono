/**
 * 切块策略（设计 §3 chunking：按仓库/语言自定义）。
 *  - markdown_aware：以 # 标题为结构边界，小节贪心打包到 chunk_size
 *  - code_aware：以函数/类/接口等定义行为边界，贪心打包 + 超长段固定窗口回退
 *  - fixed_size：固定字符窗口硬切 + overlap
 *  - auto：按扩展名选择（md/txt → markdown，代码扩展名 → code，其余 fixed）
 */

export type ChunkStrategy = "auto" | "fixed_size" | "markdown_aware" | "code_aware";

export interface Chunk {
    text: string;
    /** 文件内块序号（vector_id 的组成部分） */
    index: number;
}

/** 超过该字节数的文件跳过（防大文件/意外二进制撑爆管线） */
export const MAX_FILE_BYTES = 1_000_000;

/** NUL 字节检测（前 8KB 含 NUL 视为二进制，跳过嵌入） */
export function isBinary(buffer: Buffer): boolean {
    return buffer.subarray(0, 8192).includes(0);
}

const MARKDOWN_EXTS = ["md", "mdx", "markdown", "txt", "rst"];
const CODE_EXTS = [
    "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "rs", "java", "c",
    "cpp", "cc", "h", "hpp", "cs", "rb", "php", "swift", "kt", "scala", "sql",
];

/** auto 策略 → 实际策略（按扩展名） */
export function strategyForPath(
    filePath: string,
    strategy: ChunkStrategy,
): ChunkStrategy {
    if (strategy !== "auto") return strategy;
    const ext = filePath.slice(filePath.lastIndexOf(".") + 1).toLowerCase();
    if (MARKDOWN_EXTS.includes(ext)) return "markdown_aware";
    if (CODE_EXTS.includes(ext)) return "code_aware";
    return "fixed_size";
}

/** 固定字符窗口 + overlap（trim 后过滤空块） */
function fixedSizeChunks(
    text: string,
    chunkSize: number,
    overlap: number,
): string[] {
    if (text.length <= chunkSize) {
        const trimmed = text.trim();
        return trimmed.length > 0 ? [trimmed] : [];
    }
    const chunks: string[] = [];
    const step = Math.max(chunkSize - overlap, 1);
    for (let start = 0; start < text.length; start += step) {
        const piece = text.slice(start, start + chunkSize).trim();
        if (piece.length > 0) chunks.push(piece);
        if (start + chunkSize >= text.length) break;
    }
    return chunks;
}

/**
 * 结构边界切块：isBoundary 命中的行开启新段；段内贪心打包至 chunkSize；
 * 超长段回退 fixed_size。markdown / code 共用。
 */
function boundaryChunks(
    text: string,
    isBoundary: (line: string) => boolean,
    chunkSize: number,
    overlap: number,
): string[] {
    const sections: string[] = [];
    for (const line of text.split("\n")) {
        if (isBoundary(line) || sections.length === 0) {
            sections.push(line);
        } else {
            sections[sections.length - 1] = sections[sections.length - 1]! + "\n" + line;
        }
    }

    const chunks: string[] = [];
    let current = "";
    const flush = (): void => {
        const trimmed = current.trim();
        if (trimmed.length > 0) chunks.push(trimmed);
        current = "";
    };
    for (const section of sections) {
        if (section.trim().length === 0) continue;
        if (section.length > chunkSize) {
            flush();
            chunks.push(...fixedSizeChunks(section, chunkSize, overlap));
        } else if (current.length + section.length + 1 <= chunkSize) {
            current = current.length === 0 ? section : `${current}\n${section}`;
        } else {
            flush();
            current = section;
        }
    }
    flush();
    return chunks;
}

const HEADING_RE = /^#{1,6}\s/;

const DEF_LINE_RE =
    /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\b|class\b|def\b|fn\b|interface\b|struct\b|impl\b|enum\b|trait\b|type\s+\w+\s*=|public\s+(?:async\s+)?(?:function\b|class\b|interface\b)|private\s+(?:async\s+)?(?:function\b|class\b)|protected\s+(?:async\s+)?(?:function\b|class\b))/;

/** 切块入口：返回带 index 的块列表（index 从 0 起，供 point id 使用） */
export function chunkText(
    content: string,
    strategy: ChunkStrategy,
    chunkSize: number,
    overlap: number,
    filePath: string,
): Chunk[] {
    const actual = strategyForPath(filePath, strategy);
    const parts =
        actual === "markdown_aware"
            ? boundaryChunks(content, (line) => HEADING_RE.test(line), chunkSize, overlap)
            : actual === "code_aware"
              ? boundaryChunks(content, (line) => DEF_LINE_RE.test(line), chunkSize, overlap)
              : fixedSizeChunks(content, chunkSize, overlap);
    return parts.map((text, index) => ({ text, index }));
}
