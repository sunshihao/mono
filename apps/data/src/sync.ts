import { resolve } from "node:path";
import type { Logger } from "pino";
import type { DataConfig, RepoConfig } from "./config.js";
import { repoByName } from "./config.js";
import { createEmbedder } from "./embed.js";
import {
    createGitOps,
    EMPTY_TREE_SHA,
    type FileChange,
    type GitOps,
} from "./git.js";
import { ingestChanges, type IngestOptions } from "./ingest.js";
import { createStateStore, type StateStore, type SyncStats } from "./state.js";
import { createVectorStore } from "./vector.js";

/**
 * 同步编排（设计 §6.2/§8/§10）：
 *  - diff 起点 = state.last_synced_sha；无状态 → 空树 sha 全量（backfill），统一 diff 逻辑
 *  - 收敛检查：目标已被状态覆盖（重放/乱序旧事件）→ stale 跳过；
 *    last_synced 非 target 祖先（force-push）→ 警告后按树 diff 尽力同步
 *  - 事务化推进：向量库全部成功后才写 state（失败留在旧 sha 可整段重跑）
 */

export interface SyncDeps {
    git: GitOps;
    state: StateStore;
    ingest: (
        repo: RepoConfig,
        repoPath: string,
        targetSha: string,
        changes: FileChange[],
        options?: IngestOptions,
    ) => Promise<SyncStats>;
}

export interface SyncOptions extends IngestOptions {
    /** 指定目标 sha（默认取远端分支头）；webhook 事件传入 after */
    targetSha?: string;
    /** 无视已有 state 强制全量重建（设计 §8） */
    forceBackfill?: boolean;
    logger?: Logger;
    remote?: string;
}

export interface SyncResult {
    repo: string;
    mode: "up-to-date" | "stale-skipped" | "backfill" | "incremental";
    from: string;
    to: string;
    stats: SyncStats;
    durationMs: number;
}

const EMPTY_STATS: SyncStats = {
    added: 0,
    modified: 0,
    deleted: 0,
    renamed: 0,
    skipped: 0,
    points_upserted: 0,
    points_deleted: 0,
};

export async function syncRepo(
    repo: RepoConfig,
    repoPath: string,
    deps: SyncDeps,
    options: SyncOptions = {},
): Promise<SyncResult> {
    const started = Date.now();
    const log = options.logger;
    const remote = options.remote ?? "origin";

    await deps.git.ensureRepo(repoPath);

    // 先定目标（ls-remote 在 fetch 前，避免 fetch 期间新 push 干扰 target 钉定）
    const target =
        options.targetSha ??
        (await deps.git.lsRemote(repoPath, remote, repo.branch));

    // fetch 目标：优先按 sha（GitHub 支持）；失败回退按分支
    try {
        await deps.git.fetch(repoPath, remote, target);
    } catch {
        await deps.git.fetch(repoPath, remote, repo.branch);
    }

    const state = await deps.state.read(repo.name);

    if (!options.forceBackfill && state) {
        if (state.last_synced_sha === target) {
            return {
                repo: repo.name,
                mode: "up-to-date",
                from: target,
                to: target,
                stats: { ...EMPTY_STATS },
                durationMs: Date.now() - started,
            };
        }
        // 收敛检查：target 是状态的祖先 = 旧事件重放/乱序 → 跳过
        if (
            await deps.git.isAncestor(repoPath, target, state.last_synced_sha)
        ) {
            log?.info(
                { repo: repo.name, target, synced: state.last_synced_sha },
                "stale event: target already covered by state, skipping",
            );
            return {
                repo: repo.name,
                mode: "stale-skipped",
                from: state.last_synced_sha,
                to: target,
                stats: { ...EMPTY_STATS },
                durationMs: Date.now() - started,
            };
        }
    }

    const backfill = options.forceBackfill || !state;
    const from = backfill ? EMPTY_TREE_SHA : state!.last_synced_sha;

    if (!backfill && !(await deps.git.isAncestor(repoPath, from, target))) {
        log?.warn(
            { repo: repo.name, from, target },
            "last synced sha is not an ancestor of target (force-push/history rewrite); diffing trees as-is",
        );
    }

    const changes = await deps.git.diffNameStatus(repoPath, from, target);
    const stats = await deps.ingest(repo, repoPath, target, changes, {
        dryRun: options.dryRun,
        dimensions: options.dimensions,
        logger: log,
    });

    // 事务化：仅当向量库全部写入成功后才推进 state（设计 §10）
    if (!options.dryRun) {
        await deps.state.write({
            repo: repo.name,
            branch: repo.branch,
            last_synced_sha: target,
            last_synced_at: new Date().toISOString(),
            status: "success",
            stats,
        });
    }

    log?.info(
        {
            repo: repo.name,
            mode: backfill ? "backfill" : "incremental",
            from,
            to: target,
            stats,
        },
        "repo synced",
    );
    return {
        repo: repo.name,
        mode: backfill ? "backfill" : "incremental",
        from,
        to: target,
        stats,
        durationMs: Date.now() - started,
    };
}

export interface SyncService {
    /** 按配置中的 name 同步（CLI / worker / webhook 共用入口） */
    syncRepo(repoName: string, options?: SyncOptions): Promise<SyncResult>;
}

/**
 * 组装真实依赖（git/state/qdrant/embedder）的同步服务。
 * stateDir 与各 local_path 均相对 baseDir（默认进程 cwd，即 apps/data）。
 */
export function createSyncService(
    config: DataConfig,
    options: { stateDir?: string; baseDir?: string; logger?: Logger } = {},
): SyncService {
    const baseDir = options.baseDir ?? process.cwd();
    const git = createGitOps();
    const state = createStateStore(
        resolve(baseDir, options.stateDir ?? ".sync-state"),
        options.logger,
    );
    const store = createVectorStore(
        config.vector_store.url,
        config.vector_store.api_key,
    );
    const embedder = createEmbedder({
        provider: config.embedding.provider,
        model: config.embedding.model,
        dimensions: config.embedding.dimensions,
        apiKey: config.embedding.api_key ?? "",
        baseUrl: config.embedding.base_url,
        batchSize: config.embedding.batch_size,
    });

    return {
        async syncRepo(repoName, syncOptions = {}) {
            const repo = repoByName(config, repoName);
            if (!repo) throw new Error(`unknown repo: ${repoName}`);
            const repoPath = resolve(baseDir, repo.local_path);
            return syncRepo(
                repo,
                repoPath,
                {
                    git,
                    state,
                    ingest: (r, rp, sha, changes, opts) =>
                        ingestChanges(
                            r,
                            rp,
                            sha,
                            changes,
                            { git, store, embedder },
                            opts,
                        ),
                },
                {
                    logger: options.logger,
                    dimensions: config.embedding.dimensions,
                    ...syncOptions,
                },
            );
        },
    };
}
