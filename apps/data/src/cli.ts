import { serve } from "@hono/node-server";
import { resolve } from "node:path";
import { cleanupRepo } from "./cleanup.js";
import { repoByName } from "./config.js";
import { createDataContext } from "./context.js";
import { createGitOps } from "./git.js";
import { createQueue, createRedisKv, createRedisStream } from "./queue.js";
import { reconcileOnce, startReconcile } from "./reconcile.js";
import { buildWebhookApp, startServe } from "./serve.js";
import { createStateStore } from "./state.js";
import { createSyncService } from "./sync.js";
import { createVectorStore } from "./vector.js";
import { startWorker } from "./worker.js";

/**
 * data-service CLI（MVP 手动触发 + 单组件运维入口）。
 *
 *   sync <repo> [--target <sha>] [--backfill] [--dry-run]   单仓库同步（MVP 入口）
 *   backfill <repo> [--dry-run]                             全量重建（无视 state）
 *   cleanup <repo> [--delete-collection]                    下线清理（删点 + 删 state）
 *   status                                                  各仓库同步状态与漂移
 *   config-check                                            校验 sync.config.yaml
 *   reconcile [--once]                                      对账兜底（默认循环）
 *   worker                                                  仅消费 worker
 *   webhook                                                 仅 webhook receiver
 *   serve                                                   一体化（webhook+worker+reconcile）
 */

const USAGE = `usage: data-cli <command> [args]
commands:
  sync <repo> [--target <sha>] [--backfill] [--dry-run]
  backfill <repo> [--dry-run]
  cleanup <repo> [--delete-collection]
  status
  config-check
  reconcile [--once]
  worker
  webhook
  serve
`;

interface ParsedArgs {
    positionals: string[];
    flags: Map<string, string | boolean>;
}

function parseArgs(args: string[]): ParsedArgs {
    const positionals: string[] = [];
    const flags = new Map<string, string | boolean>();
    for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (arg.startsWith("--")) {
            const [name, inline] = arg.slice(2).split("=", 2);
            if (inline !== undefined) {
                flags.set(name!, inline);
                continue;
            }
            const next = args[i + 1];
            if (next !== undefined && !next.startsWith("--")) {
                flags.set(name!, next);
                i++;
            } else {
                flags.set(name!, true);
            }
        } else {
            positionals.push(arg);
        }
    }
    return { positionals, flags };
}

function fail(message: string): never {
    console.error(message);
    process.exit(1);
}

function printJson(value: unknown): void {
    console.log(JSON.stringify(value, null, 2));
}

function mustRepo(name: string | undefined): string {
    if (!name) fail("missing repo name\n\n" + USAGE);
    return name;
}

async function runUntilSignal(): Promise<void> {
    await new Promise<void>((resolve) => {
        const done = (): void => resolve();
        process.once("SIGINT", done);
        process.once("SIGTERM", done);
    });
}

async function main(): Promise<void> {
    const [command, ...rest] = process.argv.slice(2);
    if (!command) {
        console.log(USAGE);
        return;
    }
    const { positionals, flags } = parseArgs(rest);

    switch (command) {
        case "sync":
        case "backfill": {
            const ctx = createDataContext();
            const syncService = createSyncService(ctx.config, {
                logger: ctx.logger,
                baseDir: ctx.baseDir,
                stateDir: ctx.env.SYNC_STATE_DIR,
            });
            const repo = mustRepo(positionals[0]);
            if (!repoByName(ctx.config, repo)) fail(`unknown repo: ${repo}`);
            const result = await syncService.syncRepo(repo, {
                targetSha:
                    typeof flags.get("target") === "string"
                        ? (flags.get("target") as string)
                        : undefined,
                forceBackfill:
                    command === "backfill" || Boolean(flags.get("backfill")),
                dryRun: Boolean(flags.get("dry-run")),
            });
            printJson({
                ...result,
                note: flags.get("dry-run")
                    ? "dry-run: vector store untouched, state NOT advanced"
                    : undefined,
            });
            break;
        }

        case "cleanup": {
            const ctx = createDataContext();
            const repo = mustRepo(positionals[0]);
            const cfg = repoByName(ctx.config, repo);
            if (!cfg) fail(`unknown repo: ${repo}`);
            const result = await cleanupRepo(
                cfg,
                {
                    store: createVectorStore(
                        ctx.config.vector_store.url,
                        ctx.config.vector_store.api_key,
                    ),
                    state: createStateStore(
                        resolve(ctx.baseDir, ctx.env.SYNC_STATE_DIR),
                        ctx.logger,
                    ),
                },
                {
                    deleteCollection: Boolean(flags.get("delete-collection")),
                    logger: ctx.logger,
                },
            );
            printJson(result);
            break;
        }

        case "status": {
            const ctx = createDataContext();
            const git = createGitOps();
            const state = createStateStore(
                resolve(ctx.baseDir, ctx.env.SYNC_STATE_DIR),
                ctx.logger,
            );
            const rows = await Promise.all(
                ctx.config.repositories.map(async (repo) => {
                    const repoPath = resolve(ctx.baseDir, repo.local_path);
                    const remoteHead = await git
                        .lsRemote(repoPath, "origin", repo.branch)
                        .catch(() => "unknown");
                    const st = await state.read(repo.name);
                    return {
                        repo: repo.name,
                        collection: repo.collection,
                        branch: repo.branch,
                        syncedSha: st?.last_synced_sha ?? null,
                        syncedAt: st?.last_synced_at ?? null,
                        remoteHead,
                        drift:
                            remoteHead !== "unknown" &&
                            st?.last_synced_sha !== remoteHead,
                    };
                }),
            );
            printJson(rows);
            break;
        }

        case "config-check": {
            const ctx = createDataContext();
            printJson({
                ok: true,
                version: ctx.config.version,
                vectorStore: {
                    provider: ctx.config.vector_store.provider,
                    url: ctx.config.vector_store.url,
                    apiKeyConfigured: Boolean(ctx.config.vector_store.api_key),
                },
                embedding: {
                    provider: ctx.config.embedding.provider,
                    model: ctx.config.embedding.model,
                    dimensions: ctx.config.embedding.dimensions,
                    apiKeyConfigured: Boolean(ctx.config.embedding.api_key),
                },
                repositories: ctx.config.repositories.map((r) => ({
                    name: r.name,
                    github: r.github,
                    collection: r.collection,
                    branch: r.branch,
                    webhookSecretConfigured: Boolean(r.webhook_secret_ref),
                })),
            });
            break;
        }

        case "reconcile": {
            const ctx = createDataContext();
            if (!ctx.redis) fail("REDIS_URL required for reconcile");
            const git = createGitOps();
            const state = createStateStore(
                resolve(ctx.baseDir, ctx.env.SYNC_STATE_DIR),
                ctx.logger,
            );
            const queue = createQueue(ctx.redis, ctx.logger);
            const kv = createRedisKv(ctx.redis);
            if (flags.get("once")) {
                const report = await reconcileOnce(ctx.config, ctx.baseDir, {
                    git,
                    state,
                    kv,
                    queue,
                    logger: ctx.logger,
                });
                printJson(report);
                await ctx.redis.quit().catch(() => undefined);
                return;
            }
            const reconciler = startReconcile(
                ctx.config,
                ctx.baseDir,
                { git, state, kv, queue, logger: ctx.logger },
                ctx.env.RECONCILE_INTERVAL_MS,
            );
            await runUntilSignal();
            reconciler.stop();
            await ctx.redis.quit().catch(() => undefined);
            break;
        }

        case "worker": {
            const ctx = createDataContext();
            if (!ctx.redis) fail("REDIS_URL required for worker");
            const syncService = createSyncService(ctx.config, {
                logger: ctx.logger,
                baseDir: ctx.baseDir,
                stateDir: ctx.env.SYNC_STATE_DIR,
            });
            const queue = createQueue(ctx.redis, ctx.logger);
            const worker = startWorker(
                {
                    config: ctx.config,
                    stream: createRedisStream(ctx.redis),
                    kv: createRedisKv(ctx.redis),
                    queue,
                    syncService,
                    logger: ctx.logger,
                },
                {
                    pollIntervalMs: ctx.env.WORKER_POLL_MS,
                    leaseMs: ctx.env.WORKER_LEASE_MS,
                    maxRetries: ctx.env.WORKER_MAX_RETRIES,
                },
            );
            await runUntilSignal();
            worker.stop();
            await ctx.redis.quit().catch(() => undefined);
            break;
        }

        case "webhook": {
            const ctx = createDataContext();
            const server = serve(
                { fetch: buildWebhookApp(ctx).fetch, port: ctx.env.PORT },
                (info) => {
                    ctx.logger.info(
                        `webhook receiver listening on http://localhost:${info.port}`,
                    );
                },
            );
            await runUntilSignal();
            server.close();
            await ctx.redis?.quit().catch(() => undefined);
            break;
        }

        case "serve": {
            const ctx = createDataContext();
            const shutdownFn = await startServe(ctx);
            await runUntilSignal();
            await shutdownFn();
            break;
        }

        default:
            fail(`unknown command: ${command}\n\n${USAGE}`);
    }
}

main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
});
