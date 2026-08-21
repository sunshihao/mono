import { createHash } from "node:crypto";

export interface TextChunk {
    text: string;
    /** 块首字符在原文的偏移 */
    startCharIdx: number;
    /** 块尾字符在原文的偏移（不含） */
    endCharIdx: number;
}

interface SentenceSpan {
    text: string;
    start: number;
    end: number;
}

/**
 * 句边界切分器（对齐 ../RAG 的 SentenceSplitter(chunk_size=512, chunk_overlap=50) 语义）：
 * 按句拼装至 chunkSize，相邻块共享 chunkOverlap 字符（对齐到句边界）。
 * @llamaindex/core 0.6.x 的 TS 版未提供 SentenceSplitter，故自实现。
 */
export function splitText(
    source: string,
    options: { chunkSize?: number; chunkOverlap?: number } = {},
): TextChunk[] {
    const chunkSize = options.chunkSize ?? 512;
    const chunkOverlap = options.chunkOverlap ?? 50;

    if (source.length <= chunkSize) {
        return [{ text: source, startCharIdx: 0, endCharIdx: source.length }];
    }

    const sentences: SentenceSpan[] = [];
    const re = /[^。！？!?；;\n]+[。！？!?；;\n]?/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
        sentences.push({
            text: match[0],
            start: match.index,
            end: match.index + match[0].length,
        });
    }
    const lastEnd =
        sentences.length > 0 ? sentences[sentences.length - 1]!.end : 0;
    if (lastEnd < source.length) {
        sentences.push({
            text: source.slice(lastEnd),
            start: lastEnd,
            end: source.length,
        });
    }
    if (sentences.length === 0) {
        return [{ text: source, startCharIdx: 0, endCharIdx: source.length }];
    }

    // 超长单句（无句读的长文）按窗口硬切，块间重叠由后续回退逻辑提供
    const spans: SentenceSpan[] = [];
    for (const sentence of sentences) {
        if (sentence.text.length <= chunkSize) {
            spans.push(sentence);
            continue;
        }
        for (
            let offset = sentence.start;
            offset < sentence.end;
            offset += chunkSize
        ) {
            const end = Math.min(offset + chunkSize, sentence.end);
            spans.push({ text: source.slice(offset, end), start: offset, end });
        }
    }
    sentences.splice(0, sentences.length, ...spans);

    const chunks: TextChunk[] = [];
    let startIdx = 0;
    while (startIdx < sentences.length) {
        // 贪心拼句（单句超长时也单独成块）
        let endIdx = startIdx;
        let text = "";
        while (
            endIdx < sentences.length &&
            (text.length === 0 ||
                text.length + sentences[endIdx]!.text.length <= chunkSize)
        ) {
            text += sentences[endIdx]!.text;
            endIdx++;
        }
        chunks.push({
            text: text.trim(),
            startCharIdx: sentences[startIdx]!.start,
            endCharIdx: sentences[endIdx - 1]!.end,
        });
        if (endIdx >= sentences.length) break;

        if (chunkOverlap > 0) {
            // 下一块起点：从上一块末尾回退 chunkOverlap 字符，对齐到最近的句边界
            const overlapStart =
                chunks[chunks.length - 1]!.endCharIdx - chunkOverlap;
            let next = endIdx;
            for (let k = endIdx - 1; k > startIdx; k--) {
                if (sentences[k]!.start <= overlapStart) {
                    next = k;
                    break;
                }
            }
            startIdx = next > startIdx ? next : endIdx;
        } else {
            startIdx = endIdx;
        }
    }
    return chunks;
}

/**
 * 由内容 hash 派生稳定 UUID（v5 风格）：同一文件重摄入得到同一 document_id，
 * 支持"先删后写"的幂等索引更新。
 */
export function hashToUuid(input: string): string {
    const digest = createHash("sha1").update(input).digest();
    digest[6] = (digest[6]! & 0x0f) | 0x50; // version 5
    digest[8] = (digest[8]! & 0x3f) | 0x80; // RFC 4122 variant
    const hex = digest.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** 按扩展名推断 mime（对齐 ../RAG 的 file_type 取值风格） */
export function mimeFromPath(path: string): string {
    const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    const table: Record<string, string> = {
        md: "text/markdown",
        markdown: "text/markdown",
        txt: "text/plain",
        json: "application/json",
        html: "text/html",
        csv: "text/csv",
    };
    return table[ext] ?? "application/octet-stream";
}
