import { createHash } from "node:crypto";

/** sha256 hex（64 位）——content_hash / 幂等键的基础 */
export function sha256Hex(content: string | Buffer): string {
    return createHash("sha256").update(content).digest("hex");
}
