import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { IngestionSourceSchema } from "@repo/types";
import { z } from "zod";
import { adapterFor } from "./adapters.js";
import type { StreamClient } from "./stream.js";

/** 通用推送 body（信封由服务端补全：id/status/mtime） */
const WebhookBodySchema = z.object({
    path: z.string().min(1),
    doc_hash: z.string().regex(/^[0-9a-f]{64}$/),
    mtime: z.string().datetime().optional(),
});

/** 支持的路由源：通用三类 + SaaS 适配源（信封 source 归为 "webhook"） */
const SourceParamSchema = z.object({
    source: z.enum(["fs", "webhook", "poll", "notion", "confluence"]),
});

/**
 * POST /webhooks/:source ——
 *  - fs/webhook/poll：通用 body（path + doc_hash）
 *  - notion/confluence：按各自 webhook 格式规范化（见 adapters.ts）
 */
export function createWebhookApp(stream: StreamClient): Hono {
    const app = new Hono();

    app.post(
        "/webhooks/:source",
        zValidator("param", SourceParamSchema),
        async (c) => {
            const { source } = c.req.valid("param") as {
                source: string;
            };

            const raw = await c.req.json().catch(() => null);
            const adapter = adapterFor(source);
            if (adapter) {
                const normalized = raw ? adapter.normalize(raw) : null;
                if (!normalized) {
                    return c.json(
                        {
                            error: "validation_error",
                            issues: [
                                {
                                    message: `invalid ${source} webhook payload`,
                                },
                            ],
                        },
                        400,
                    );
                }
                // SaaS 源统一归入 "webhook" 类信封
                const envelope = await stream.publish(
                    "webhook",
                    normalized.path,
                    normalized.doc_hash,
                );
                return c.json(envelope, 202);
            }

            const body = WebhookBodySchema.safeParse(raw);
            if (!body.success) {
                return c.json(
                    { error: "validation_error", issues: body.error.issues },
                    400,
                );
            }
            const envelope = await stream.publish(
                source as z.infer<typeof IngestionSourceSchema>,
                body.data.path,
                body.data.doc_hash,
            );
            return c.json(envelope, 202);
        },
    );

    return app;
}
