import { resolve } from "node:path";
import type { Logger } from "pino";
import type { DataConfig } from "./config.js";
import { EMPTY_TREE_SHA, type GitOps } from "./git.js";
import {
    deliveryKeyFor,
    type KvOps,
    type Queue,
} from "./queue.js";
import type { StateStore } from "./state.js";

/**
 * 定时对账（设计 §10 兜底）：webhook 丢失/宕机时，比对远端头与
 * state.last_synced_sha，落后则补投递同步事件（经队列，与其他来源统一有序）。
 * 同一远端头 5 分钟内只投递一次（SET NX），成功同步后 processed 集合
 * 兜底去重（deliveryId = reconcile:<sha>）。
 */

export interface ReconcileDeps {
    git: GitOps;
    state: StateStore;
    kv: KvOps;
    queue: Queue;
    logger: Logger;
}

export interface ReconcileReport {
    checked: number;
    enqueued: number;
    drifted: { repo: string; synced: string | null; remote: string }[];
}

const RECONCILE_IDEM_TTL_MS = 300_000;

export async function reconcileOnce(
    config: DataConfig,
    baseDir: string,
    deps: ReconcileDeps,
): Promise<ReconcileReport> {
    const report: ReconcileReport = { checked: 0, enqueued: 0, drifted: [] };
    for (const repo of config.repositories) {
        report.checked++;
        const repoPath = resolve(baseDir, repo.local_path);
        const head = await deps.git.lsRemote(repoPath, "origin", repo.branch);
        const state = await deps.state.read(repo.name);
        if (state && state.last_synced_sha === head) continue;

        const idemKey = `reconcile:${deliveryKeyFor(repo.name, head)}`;
        const first = await deps.kv.setNxEx(idemKey, "1", RECONCILE_IDEM_TTL_MS);
        if (!first) continue; // 刚投递过（worker 可能正在处理）

        await deps.queue.publish({
            repo: repo.name,
            before: state?.last_synced_sha ?? EMPTY_TREE_SHA,
            after: head,
            ref: `refs/heads/${repo.branch}`,
            deliveryId: `reconcile:${head}`,
            attempt: 0,
        });
        report.enqueued++;
        report.drifted.push({
            repo: repo.name,
            synced: state?.last_synced_sha ?? null,
            remote: head,
        });
        deps.logger.info(
            { repo: repo.name, synced: state?.last_synced_sha ?? null, remote: head },
            "drift detected, sync event enqueued",
        );
    }
    return report;
}

export interface Reconciler {
    stop(): void;
}

export function startReconcile(
    config: DataConfig,
    baseDir: string,
    deps: ReconcileDeps,
    intervalMs: number,
): Reconciler {
    const timer = setInterval(() => {
        void reconcileOnce(config, baseDir, deps).catch((err: unknown) => {
            deps.logger.error({ err }, "reconcile round failed");
        });
    }, intervalMs);
    deps.logger.info({ intervalMs }, "reconcile started");
    return {
        stop() {
            clearInterval(timer);
        },
    };
}
