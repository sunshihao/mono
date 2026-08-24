import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { Logger } from "pino";

/**
 * 同步状态存储（设计 §5/§6.2）：每个仓库一个 JSON 文件，记录
 * "最后成功同步的 commit sha"——增量 diff 的起点、失败重跑的锚点。
 * 写入走 tmp+rename 原子替换，避免崩溃留下半个文件。
 */

export const SyncStatsSchema = z.object({
    added: z.number().int().nonnegative(),
    modified: z.number().int().nonnegative(),
    deleted: z.number().int().nonnegative(),
    renamed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    points_upserted: z.number().int().nonnegative(),
    points_deleted: z.number().int().nonnegative(),
});
export type SyncStats = z.infer<typeof SyncStatsSchema>;

export const SyncStateSchema = z.object({
    repo: z.string().min(1),
    branch: z.string().min(1),
    last_synced_sha: z.string().regex(/^[0-9a-f]{40}$/),
    last_synced_at: z.string().datetime(),
    status: z.literal("success"),
    stats: SyncStatsSchema.optional(),
});
export type SyncState = z.infer<typeof SyncStateSchema>;

export interface StateStore {
    /** 无状态文件 / 损坏 → null（调用方按"需要全量 backfill"处理） */
    read(repoName: string): Promise<SyncState | null>;
    write(state: SyncState): Promise<void>;
    remove(repoName: string): Promise<void>;
}

export function createStateStore(
    dir: string,
    logger?: Logger,
): StateStore {
    const pathFor = (repoName: string): string => join(dir, `${repoName}.state.json`);

    return {
        async read(repoName) {
            let raw: string;
            try {
                raw = await readFile(pathFor(repoName), "utf8");
            } catch {
                return null; // 首次接入：无状态文件
            }
            let json: unknown;
            try {
                json = JSON.parse(raw);
            } catch {
                logger?.warn({ repo: repoName }, "state file corrupt, treating as unsynced (backfill)");
                return null;
            }
            const parsed = SyncStateSchema.safeParse(json);
            if (!parsed.success) {
                logger?.warn(
                    { repo: repoName, issues: parsed.error.issues },
                    "state file schema mismatch, treating as unsynced (backfill)",
                );
                return null;
            }
            return parsed.data;
        },
        async write(state) {
            await mkdir(dir, { recursive: true });
            const target = pathFor(state.repo);
            const tmp = `${target}.tmp-${process.pid}`;
            await writeFile(tmp, JSON.stringify(state, null, 2) + "\n");
            await rename(tmp, target);
        },
        async remove(repoName) {
            await rm(pathFor(repoName), { force: true });
        },
    };
}
