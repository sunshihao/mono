import type { Logger } from "pino";
import picomatch from "picomatch";
import { chunkText, isBinary, MAX_FILE_BYTES } from "./chunk.js";
import type { RepoConfig } from "./config.js";
import type { Embedder } from "./embed.js";
import type { FileChange, GitOps } from "./git.js";
import { sha256Hex } from "./lib/hash.js";
import type { SyncStats } from "./state.js";
import { pointIdFor, type VectorPoint, type VectorStore } from "./vector.js";

/**
 * 文件变更 → 向量库 的摄入管线（设计 §6.1 状态映射 + §7 幂等）。
 *
 *  - A：读内容 → 切块 → 嵌入 → upsert（point id 确定性，重复摄入覆盖写）
 *  - M：先取旧点集；content_hash 未变则跳过（免重嵌）；
 *       否则 upsert 新块后按"旧 id − 新 id"差集删除（防文件变短残留僵尸向量，设计 §7.2）
 *  - D：按 file_path 收集旧点 → 全删
 *  - R：内容未变 → 向量搬运（新 path 新 id，免重嵌，设计 §6.1 优化项）；
 *       内容变化 → 删旧 + 增新；移入/移出 include 范围按 A/D 处理
 *  - 二进制 / 超限文件跳过（metadata 只进文本）
 */

export interface IngestDeps {
    git: GitOps;
    store?: VectorStore;
    embedder?: Embedder;
}

export interface IngestOptions {
    /** 只读内容 + 切块统计，不嵌入/不写库（CLI --dry-run） */
    dryRun?: boolean;
    /** 提供时自动 ensureCollection（未提供则假设集合已存在） */
    dimensions?: number;
    logger?: Logger;
}

interface UpsertAction {
    filePath: string;
    content: Buffer;
    contentHash: string;
}

/** 读指定 commit 下的文件；二进制/超限/不可读 → null（跳过） */
async function readIndexable(
    git: GitOps,
    repoPath: string,
    sha: string,
    filePath: string,
    log: Logger | undefined,
): Promise<Buffer | null> {
    let content: Buffer;
    try {
        content = await git.showFile(repoPath, sha, filePath);
    } catch (err) {
        log?.warn({ filePath, err }, "cannot read file at target sha, skipping");
        return null;
    }
    if (isBinary(content)) return null;
    if (content.length > MAX_FILE_BYTES) {
        log?.info({ filePath, bytes: content.length }, "file exceeds MAX_FILE_BYTES, skipping");
        return null;
    }
    return content;
}

export async function ingestChanges(
    repo: RepoConfig,
    repoPath: string,
    targetSha: string,
    changes: FileChange[],
    deps: IngestDeps,
    options: IngestOptions = {},
): Promise<SyncStats> {
    const { git } = deps;
    const store = deps.store;
    const embedder = deps.embedder;
    const log = options.logger;
    if (!options.dryRun && (!store || !embedder)) {
        throw new Error("ingest requires vector store + embedder (or dryRun)");
    }

    const isIncluded = picomatch(repo.include);
    const isExcluded = repo.exclude.length > 0 ? picomatch(repo.exclude) : null;
    const inScope = (p: string): boolean =>
        isIncluded(p) && !(isExcluded?.(p) ?? false);

    const stats: SyncStats = {
        added: 0,
        modified: 0,
        deleted: 0,
        renamed: 0,
        skipped: 0,
        points_upserted: 0,
        points_deleted: 0,
    };

    if (store && !options.dryRun && options.dimensions) {
        await store.ensureCollection(repo.collection, options.dimensions);
    }

    const upserts: UpsertAction[] = [];
    /** D / R-old / R 内容变化 的待删路径 */
    const deletePaths = new Set<string>();
    /** M 文件的旧点 id 集合（upsert 后做差集删除） */
    const cleanupOldIds = new Map<string, Set<string>>();

    // ---- Phase 1：分类 + 读内容 + M/R 旧点采集 ----
    for (const change of changes) {
        if (change.status === "D") {
            if (change.oldPath && inScope(change.oldPath)) {
                deletePaths.add(change.oldPath);
                stats.deleted++;
            } else {
                stats.skipped++;
            }
            continue;
        }

        if (change.status === "A") {
            const p = change.newPath;
            if (!p || !inScope(p)) {
                stats.skipped++;
                continue;
            }
            const content = await readIndexable(git, repoPath, targetSha, p, log);
            if (!content) {
                stats.skipped++;
                continue;
            }
            upserts.push({ filePath: p, content, contentHash: sha256Hex(content) });
            stats.added++;
            continue;
        }

        if (change.status === "M") {
            const p = change.newPath;
            if (!p || !inScope(p)) {
                stats.skipped++;
                continue;
            }
            const content = await readIndexable(git, repoPath, targetSha, p, log);
            if (!content) {
                stats.skipped++;
                continue;
            }
            const contentHash = sha256Hex(content);
            if (!options.dryRun && store) {
                const oldPoints = await store.listByFilePath(
                    repo.collection,
                    p,
                    false,
                );
                if (
                    oldPoints.length > 0 &&
                    oldPoints.every(
                        (pt) => pt.payload["content_hash"] === contentHash,
                    )
                ) {
                    // 内容未变（如仅 mode/行尾变化）：跳过，免重嵌
                    stats.skipped++;
                    continue;
                }
                if (oldPoints.length > 0) {
                    cleanupOldIds.set(
                        p,
                        new Set(oldPoints.map((pt) => pt.id)),
                    );
                }
            }
            upserts.push({ filePath: p, content, contentHash });
            stats.modified++;
            continue;
        }

        // R：重命名（可能伴随内容变化）
        const { oldPath, newPath } = change;
        const oldIn = Boolean(oldPath && inScope(oldPath));
        const newIn = Boolean(newPath && inScope(newPath));
        if (!oldIn && !newIn) {
            stats.skipped++;
            continue;
        }
        if (!oldIn && newIn) {
            // 移入范围 → 按新增处理
            const content = await readIndexable(git, repoPath, targetSha, newPath!, log);
            if (!content) {
                stats.skipped++;
                continue;
            }
            upserts.push({ filePath: newPath!, content, contentHash: sha256Hex(content) });
            stats.added++;
            continue;
        }
        if (oldIn && !newIn) {
            // 移出范围 → 按删除处理
            deletePaths.add(oldPath!);
            stats.deleted++;
            continue;
        }

        // 两端都在范围内
        const content = await readIndexable(git, repoPath, targetSha, newPath!, log);
        if (!content) {
            // 新内容不可索引（二进制等）：清理旧点
            deletePaths.add(oldPath!);
            stats.deleted++;
            continue;
        }
        const contentHash = sha256Hex(content);
        if (!options.dryRun && store) {
            const oldPoints = await store.listByFilePath(
                repo.collection,
                oldPath!,
                true,
            );
            if (
                oldPoints.length > 0 &&
                oldPoints.every(
                    (pt) => pt.payload["content_hash"] === contentHash,
                )
            ) {
                // 内容未变：向量搬运到新 path（免重嵌）
                const moved: VectorPoint[] = oldPoints.map((pt) => ({
                    id: pointIdFor(
                        repo.name,
                        newPath!,
                        Number(pt.payload["chunk_index"] ?? 0),
                    ),
                    vector: pt.vector ?? [],
                    payload: {
                        ...pt.payload,
                        file_path: newPath,
                        commit_sha: targetSha,
                    },
                }));
                await store.upsert(repo.collection, moved);
                await store.deleteByIds(
                    repo.collection,
                    oldPoints.map((pt) => pt.id),
                );
                stats.points_upserted += moved.length;
                stats.points_deleted += oldPoints.length;
                stats.renamed++;
                continue;
            }
        }
        // 内容变化（或 dry-run）：删旧 + 增新
        deletePaths.add(oldPath!);
        upserts.push({ filePath: newPath!, content, contentHash });
        stats.renamed++;
    }

    // ---- Phase 2：切块 → 嵌入 → upsert（M 差集删除紧跟其后）----
    const chunked: { filePath: string; index: number; text: string }[] = [];
    for (const u of upserts) {
        const text = u.content.toString("utf8");
        for (const chunk of chunkText(
            text,
            repo.chunking.strategy,
            repo.chunking.chunk_size,
            repo.chunking.overlap,
            u.filePath,
        )) {
            chunked.push({ filePath: u.filePath, index: chunk.index, text: chunk.text });
        }
    }

    if (!options.dryRun && store && embedder) {
        if (chunked.length > 0) {
            const vectors = await embedder.embedTexts(
                chunked.map((c) => c.text),
            );
            const contentHashByPath = new Map(
                upserts.map((u) => [u.filePath, u.contentHash]),
            );
            const now = new Date().toISOString();
            const points: VectorPoint[] = chunked.map((c, i) => ({
                id: pointIdFor(repo.name, c.filePath, c.index),
                vector: vectors[i]!,
                payload: {
                    repo: repo.name,
                    file_path: c.filePath,
                    chunk_index: c.index,
                    commit_sha: targetSha,
                    branch: repo.branch,
                    updated_at: now,
                    content_hash: contentHashByPath.get(c.filePath) ?? "",
                    text: c.text,
                },
            }));
            await store.upsert(repo.collection, points);
            stats.points_upserted += points.length;

            // M 旧 chunk 差集清理（设计 §7.2）：文件变短时不残留僵尸向量
            for (const [filePath, oldIds] of cleanupOldIds) {
                const newIds = new Set(
                    points
                        .filter((p) => p.payload["file_path"] === filePath)
                        .map((p) => p.id),
                );
                const toDelete = [...oldIds].filter((id) => !newIds.has(id));
                if (toDelete.length > 0) {
                    await store.deleteByIds(repo.collection, toDelete);
                    stats.points_deleted += toDelete.length;
                }
            }
        }
    } else {
        stats.points_upserted = chunked.length; // dry-run：规划数量
    }

    // ---- Phase 3：删除（D / R-old / R 内容变化）----
    if (!options.dryRun && store && deletePaths.size > 0) {
        const idsToDelete: string[] = [];
        for (const p of deletePaths) {
            const pts = await store.listByFilePath(repo.collection, p, false);
            idsToDelete.push(...pts.map((pt) => pt.id));
        }
        if (idsToDelete.length > 0) {
            await store.deleteByIds(repo.collection, idsToDelete);
            stats.points_deleted += idsToDelete.length;
        }
    }

    return stats;
}
