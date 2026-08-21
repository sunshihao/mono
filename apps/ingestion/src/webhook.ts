import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { IngestionSourceSchema, type IngestionSource } from "@repo/types";
import { z } from "zod";
import type { StreamClient } from "./stream.js";

/** SaaS 数据源推送（Confluence/Notion 等）：信封由服务端补全（id/status/mtime） */
const WebhookBodySchema = z.object({
    path: z.string().min(1),
    doc_hash: z.string().regex(/^[0-9a-f]{64}$/),
    mtime: z.string().datetime().optional(),
});

/** POST /webhooks/:source —— :source ∈ fs|webhook|poll（消费方过滤用） */
export function createWebhookApp(stream: StreamClient): Hono {
    const app = new Hono();

    app.post(
        "/webhooks/:source",
        zValidator("param", z.object({ source: IngestionSourceSchema })),
        zValidator("json", WebhookBodySchema, (result, c) => {
            if (!result.success) {
                return c.json(
                    { error: "validation_error", issues: result.error.issues },
                    400,
                );
            }
        }),
        async (c) => {
            const { source } = c.req.valid("param") as {
                source: IngestionSource;
            };
            const body = c.req.valid("json");
            const envelope = await stream.publish(
                source,
                body.path,
                body.doc_hash,
            );
            return c.json(envelope, 202);
        },
    );

    return app;
}
