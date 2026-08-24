import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { Logger } from "pino";
import { z } from "zod";
import type { DataConfig } from "./config.js";
import { repoByGithub } from "./config.js";
import { ZERO_SHA } from "./git.js";
import { deliveryKeyFor, type KvOps, type Queue } from "./queue.js";

/**
 * GitHub push webhook receiver（设计 §5）。
 *
 * 处理顺序（§5.2）：解析 payload → 按 full_name 查配置 → 每仓库 secret
 * HMAC-SHA256 签名校验（timingSafeEqual）→ 分支过滤 → 分支删除忽略 →
 * 幂等键（sha256(repo+after) SET NX）→ XADD 对应仓库流。
 *
 * 注意：签名校验依赖 payload 中的仓库全名来选 secret，因此未知仓库
 * 直接 404（无 secret 可校验）；secret 未配置 / Redis 不可用 → 503
 * （fail-safe，宁可不收也不伪造签名入库）。
 */

const PushPayloadSchema = z.object({
    repository: z.object({
        full_name: z.string().min(1),
    }),
    before: z.string().min(1),
    after: z.string().min(1),
    ref: z.string().min(1),
});

/** webhook 幂等键 TTL：同一 push 重复投递窗口 */
const IDEM_TTL_MS = 3600_000;

export interface WebhookDeps {
    config: DataConfig;
    queue: Queue;
    kv: KvOps;
    logger: Logger;
    /** /readyz 上报；redis 缺失时 receiver 拒绝接收（503） */
    redisAvailable: boolean;
}

export function createWebhookApp(deps: WebhookDeps): Hono {
    const app = new Hono();

    app.get("/healthz", (c) => c.json({ ok: true }));

    app.get("/readyz", (c) =>
        c.json({ ok: true, redis: deps.redisAvailable }),
    );

    app.post("/webhook/github", async (c) => {
        const event = c.req.header("x-github-event") ?? "push";
        if (event !== "push") {
            // GitHub 建 webhook 时会发 ping；其他未订阅事件一律忽略
            return c.json({ status: "ignored", reason: `event:${event}` }, 200);
        }

        let raw: string;
        try {
            raw = await c.req.text();
        } catch {
            return c.json({ error: "unreadable_body" }, 400);
        }

        let payload: z.infer<typeof PushPayloadSchema>;
        try {
            const parsed = PushPayloadSchema.safeParse(JSON.parse(raw));
            if (!parsed.success) {
                return c.json(
                    { error: "invalid_payload", issues: parsed.error.issues },
                    400,
                );
            }
            payload = parsed.data;
        } catch {
            return c.json({ error: "invalid_json" }, 400);
        }

        const repo = repoByGithub(deps.config, payload.repository.full_name);
        if (!repo) {
            return c.json(
                { error: "unknown_repo", repo: payload.repository.full_name },
                404,
            );
        }

        // 每仓库独立 webhook secret（设计 §3：便于单仓库轮换）
        if (!repo.webhook_secret_ref) {
            deps.logger.error(
                { repo: repo.name },
                "webhook_secret_ref not configured, rejecting push (fail-safe)",
            );
            return c.json({ error: "webhook_secret_not_configured" }, 503);
        }
        const signature = c.req.header("x-hub-signature-256") ?? "";
        const match = /^sha256=([0-9a-f]{64})$/.exec(signature);
        if (!match) {
            return c.json({ error: "invalid_signature" }, 400);
        }
        const expected = createHmac("sha256", repo.webhook_secret_ref)
            .update(raw)
            .digest("hex");
        const actualBuf = Buffer.from(match[1]!, "hex");
        const expectedBuf = Buffer.from(expected, "hex");
        if (
            actualBuf.length !== expectedBuf.length ||
            !timingSafeEqual(actualBuf, expectedBuf)
        ) {
            deps.logger.warn({ repo: repo.name }, "webhook signature mismatch");
            return c.json({ error: "invalid_signature" }, 400);
        }

        if (payload.ref !== `refs/heads/${repo.branch}`) {
            return c.json(
                { status: "ignored", reason: "branch_mismatch", ref: payload.ref },
                200,
            );
        }
        if (payload.after === ZERO_SHA) {
            // 分支删除事件：忽略（清理走 cleanup 命令/配置下线流程，设计 §5.2.5）
            return c.json({ status: "ignored", reason: "branch_deleted" }, 200);
        }

        const deliveryId =
            c.req.header("x-github-delivery") ?? `webhook-${Date.now()}`;
        const idemKey = `webhook:${deliveryKeyFor(repo.name, payload.after)}`;

        try {
            const first = await deps.kv.setNxEx(idemKey, "1", IDEM_TTL_MS);
            if (!first) {
                return c.json(
                    { status: "duplicate", repo: repo.name, after: payload.after },
                    200,
                );
            }
            const id = await deps.queue.publish({
                repo: repo.name,
                before: payload.before,
                after: payload.after,
                ref: payload.ref,
                deliveryId,
                attempt: 0,
            });
            return c.json(
                { status: "queued", repo: repo.name, after: payload.after, id },
                202,
            );
        } catch (err) {
            deps.logger.error({ repo: repo.name, err }, "cannot enqueue webhook event");
            return c.json({ error: "queue_unavailable" }, 503);
        }
    });

    return app;
}
