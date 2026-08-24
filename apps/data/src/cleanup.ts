import type { Logger } from "pino";
import type { RepoConfig } from "./config.js";
import type { StateStore } from "./state.js";
import type { VectorStore } from "./vector.js";

/**
 * 仓库下线清理（设计 §9）：按 metadata.repo 批量删除向量点 →
 * 删除 state 文件 → 可选整集合删除；保留审计日志行（不静默清空）。
 */

export interface CleanupOptions {
    /** 连 collection 一起删除（默认只删点，保留集合结构） */
    deleteCollection?: boolean;
    logger?: Logger;
}

export interface CleanupResult {
    repo: string;
    collection: string;
    collectionDeleted: boolean;
    stateRemoved: boolean;
}

export async function cleanupRepo(
    repo: RepoConfig,
    deps: { store: VectorStore; state: StateStore },
    options: CleanupOptions = {},
): Promise<CleanupResult> {
    const log = options.logger;
    if (options.deleteCollection) {
        await deps.store.dropCollection(repo.collection);
    } else {
        await deps.store.deleteByRepo(repo.collection, repo.name);
    }
    await deps.state.remove(repo.name);
    log?.info(
        {
            repo: repo.name,
            collection: repo.collection,
            deleteCollection: Boolean(options.deleteCollection),
        },
        "repo removed from vector store (audit)",
    );
    return {
        repo: repo.name,
        collection: repo.collection,
        collectionDeleted: Boolean(options.deleteCollection),
        stateRemoved: true,
    };
}
