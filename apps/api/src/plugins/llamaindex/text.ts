/**
 * LlamaIndexTS 的 MessageContent 是联合类型（string | 各类分块数组），
 * 统一提取纯文本。防御性实现：未知形态返回空串。
 */
interface TextPart {
    type?: string;
    text?: unknown;
}

export function extractText(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content
            .map((part) => {
                if (typeof part === "string") return part;
                if (part && typeof part === "object") {
                    const p = part as TextPart;
                    if (typeof p.text === "string") return p.text;
                }
                return "";
            })
            .join("");
    }
    return "";
}
