import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** sha256 hex（64 位）——doc_hash 去重键，对齐 ../RAG 的 docstore 语义 */
export function sha256Hex(content: string | Buffer): string {
    return createHash("sha256").update(content).digest("hex");
}

/** 扫描目录返回 绝对路径 → 内容 hash 映射（watcher 基线与 poller 比对共用） */
export async function computeFileHashes(dir: string): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const entries = await readdir(dir, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isFile()) continue;
        const fullPath = join(entry.parentPath, entry.name);
        const content = await readFile(fullPath);
        result.set(fullPath, sha256Hex(content));
    }
    return result;
}
