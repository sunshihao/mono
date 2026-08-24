import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/lib/logger.js";
import type { KvOps, Queue, SyncMessage } from "../src/queue.js";
import { createWebhookApp, type WebhookDeps } from "../src/webhook.js";
import { ZERO_SHA } from "../src/git.js";

const SECRET = "webhook-secret-1";
const AFTER = "c".repeat(40);
const BEFORE = "a".repeat(40);

const CONFIG = {
    version: 1 as const,
    vector_store: { provider: "qdrant" as const, url: "http://qdrant:6333" },
    embedding: {
        provider: "dashscope" as const,
        model: "text-embedding-v4",
        dimensions: 1024,
        batch_size: 16,
        api_key: "sk-x",
    },
    repositories: [
        {
            name: "r1",
            github: "org/r1",
            local_path: "repos/r1",
            branch: "main",
            collection: "r1-main",
            include: ["**/*"],
            exclude: [],
            chunking: {
                strategy: "fixed_size" as const,
                chunk_size: 100,
                overlap: 10,
            },
            webhook_secret_ref: SECRET,
        },
    ],
};

interface FakeKv extends KvOps {
    keys: Map<string, string>;
}

function fakeKv(): FakeKv {
    const keys = new Map<string, string>();
    return {
        keys,
        setNxEx: vi.fn(async (key: string, value: string) => {
            if (keys.has(key)) return false;
            keys.set(key, value);
            return true;
        }),
        setPx: vi.fn(async () => {}),
        del: vi.fn(async (key: string) => {
            keys.delete(key);
        }),
        sismember: vi.fn(async () => false),
        sadd: vi.fn(async () => {}),
        expire: vi.fn(async () => {}),
        zadd: vi.fn(async () => {}),
        zpopmin: vi.fn(async () => []),
    };
}

function fakeQueue(): { queue: Queue; published: SyncMessage[] } {
    const published: SyncMessage[] = [];
    return {
        published,
        queue: {
            publish: vi.fn(async (msg: SyncMessage) => {
                published.push(msg);
                return "stream-id";
            }),
            markProcessed: vi.fn(async () => {}),
            isProcessed: vi.fn(async () => false),
            toDlq: vi.fn(async () => {}),
        },
    };
}

function buildDeps(overrides: Partial<WebhookDeps> = {}) {
    const kv = fakeKv();
    const { queue, published } = fakeQueue();
    const deps: WebhookDeps = {
        config: CONFIG,
        queue,
        kv,
        logger: createLogger("silent"),
        redisAvailable: true,
        ...overrides,
    };
    return { deps, kv, queue, published };
}

function pushBody(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
        repository: { full_name: "org/r1" },
        before: BEFORE,
        after: AFTER,
        ref: "refs/heads/main",
        ...overrides,
    });
}

function signedHeaders(body: string, secret = SECRET): Record<string, string> {
    const sig = createHmac("sha256", secret).update(body).digest("hex");
    return {
        "content-type": "application/json",
        "x-github-event": "push",
        "x-github-delivery": "delivery-123",
        "x-hub-signature-256": `sha256=${sig}`,
    };
}

async function post(
    app: ReturnType<typeof createWebhookApp>,
    body: string,
    headers: Record<string, string>,
) {
    return app.request("/webhook/github", { method: "POST", body, headers });
}

describe("webhook /webhook/github", () => {
    it("合法 push → 202 入队，携带 delivery id", async () => {
        const { deps, published } = buildDeps();
        const app = createWebhookApp(deps);
        const body = pushBody();
        const res = await post(app, body, signedHeaders(body));

        expect(res.status).toBe(202);
        expect(published).toHaveLength(1);
        expect(published[0]).toMatchObject({
            repo: "r1",
            before: BEFORE,
            after: AFTER,
            ref: "refs/heads/main",
            deliveryId: "delivery-123",
            attempt: 0,
        });
    });

    it("签名错误 → 400 invalid_signature", async () => {
        const { deps, published } = buildDeps();
        const app = createWebhookApp(deps);
        const body = pushBody();
        const res = await post(app, body, signedHeaders(body, "wrong-secret"));
        expect(res.status).toBe(400);
        expect(((await res.json()) as { error: string }).error).toBe(
            "invalid_signature",
        );
        expect(published).toHaveLength(0);
    });

    it("缺失签名头 → 400", async () => {
        const { deps } = buildDeps();
        const app = createWebhookApp(deps);
        const body = pushBody();
        const res = await post(app, body, {
            "content-type": "application/json",
            "x-github-event": "push",
        });
        expect(res.status).toBe(400);
    });

    it("未知仓库 → 404", async () => {
        const { deps } = buildDeps();
        const app = createWebhookApp(deps);
        const body = pushBody({ repository: { full_name: "other/repo" } });
        const res = await post(app, body, signedHeaders(body));
        expect(res.status).toBe(404);
    });

    it("分支不匹配 → 200 ignored", async () => {
        const { deps } = buildDeps();
        const app = createWebhookApp(deps);
        const body = pushBody({ ref: "refs/heads/develop" });
        const res = await post(app, body, signedHeaders(body));
        expect(res.status).toBe(200);
        expect(((await res.json()) as { reason: string }).reason).toBe(
            "branch_mismatch",
        );
    });

    it("分支删除（after 全零）→ 200 ignored", async () => {
        const { deps } = buildDeps();
        const app = createWebhookApp(deps);
        const body = pushBody({ after: ZERO_SHA });
        const res = await post(app, body, signedHeaders(body));
        expect(res.status).toBe(200);
        expect(((await res.json()) as { reason: string }).reason).toBe(
            "branch_deleted",
        );
    });

    it("同一 after 重复投递 → 200 duplicate（幂等键）", async () => {
        const { deps, published } = buildDeps();
        const app = createWebhookApp(deps);
        const body = pushBody();
        const headers = signedHeaders(body);
        expect((await post(app, body, headers)).status).toBe(202);
        expect((await post(app, body, headers)).status).toBe(200);
        expect(
            (await post(app, body, headers)).json() as Promise<{
                status: string;
            }>,
        ).resolves.toMatchObject({ status: "duplicate" });
        expect(published).toHaveLength(1);
    });

    it("仓库未配置 secret → 503（fail-safe）", async () => {
        const { deps } = buildDeps();
        deps.config = {
            ...CONFIG,
            repositories: [
                { ...CONFIG.repositories[0]!, webhook_secret_ref: undefined },
            ],
        };
        const app = createWebhookApp(deps);
        const body = pushBody();
        const res = await post(app, body, signedHeaders(body));
        expect(res.status).toBe(503);
        expect(((await res.json()) as { error: string }).error).toBe(
            "webhook_secret_not_configured",
        );
    });

    it("非 push 事件（ping）→ 200 ignored", async () => {
        const { deps } = buildDeps();
        const app = createWebhookApp(deps);
        const body = pushBody();
        const res = await post(app, body, {
            "content-type": "application/json",
            "x-github-event": "ping",
            "x-hub-signature-256": "sha256=" + "0".repeat(64),
        });
        expect(res.status).toBe(200);
    });

    it("queue 不可用（redis 挂）→ 503 queue_unavailable", async () => {
        const { deps } = buildDeps();
        deps.queue = {
            publish: vi.fn(async () => {
                throw new Error("redis down");
            }),
            markProcessed: vi.fn(async () => {}),
            isProcessed: vi.fn(async () => false),
            toDlq: vi.fn(async () => {}),
        };
        const app = createWebhookApp(deps);
        const body = pushBody();
        const res = await post(app, body, signedHeaders(body));
        expect(res.status).toBe(503);
        expect(((await res.json()) as { error: string }).error).toBe(
            "queue_unavailable",
        );
    });

    it("payload 非法 JSON → 400", async () => {
        const { deps } = buildDeps();
        const app = createWebhookApp(deps);
        const res = await post(app, "not json", signedHeaders("not json"));
        expect(res.status).toBe(400);
    });

    it("healthz / readyz", async () => {
        const { deps } = buildDeps();
        const app = createWebhookApp(deps);
        expect((await app.request("/healthz")).status).toBe(200);
        const ready = (await (await app.request("/readyz")).json()) as {
            redis: boolean;
        };
        expect(ready.redis).toBe(true);
    });
});
