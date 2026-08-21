import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ReadinessDtoSchema } from "@repo/types";
import { createApp } from "../src/app.js";
import { plugins, type Plugin } from "../src/plugins/index.js";

describe("healthz / readyz", () => {
    it("/healthz 存活探测恒 200", async () => {
        const { app, dispose } = await createApp(plugins, { env: {} });
        const res = await app.request("/healthz");
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ status: "ok" });
        await dispose();
    });

    it("/readyz：无任何集成配置 → 200 ready，langgraph 常驻，其余 disabled", async () => {
        const { app, dispose } = await createApp(plugins, { env: {} });
        const res = await app.request("/readyz");
        expect(res.status).toBe(200);
        const body = ReadinessDtoSchema.parse(await res.json());
        expect(body.status).toBe("ready");
        expect(body.plugins).toHaveLength(6);

        const byName = new Map(body.plugins.map((p) => [p.name, p]));
        expect(byName.get("langgraph")?.status).toBe("ready"); // 内存态占位，无需外部配置
        for (const name of [
            "redis",
            "db",
            "qdrant",
            "observability",
            "llamaindex",
        ]) {
            expect(byName.get(name)?.status).toBe("disabled");
        }
        expect(byName.get("redis")?.reason).toContain("REDIS_URL");
        await dispose();
    });

    it("/readyz：有 enabled 插件健康失败 → 503 degraded", async () => {
        const failing: Plugin = {
            name: "redis",
            version: "0.0.0",
            configSchema: z.object({}),
            init: async () => ({ client: {} }),
            health: async () => ({ ok: false, reason: "PING failed" }),
        };
        const { app, dispose } = await createApp([failing], { env: {} });
        const res = await app.request("/readyz");
        expect(res.status).toBe(503);
        const body = ReadinessDtoSchema.parse(await res.json());
        expect(body.status).toBe("degraded");
        expect(body.plugins).toContainEqual({
            name: "redis",
            status: "error",
            reason: "PING failed",
        });
        await dispose();
    });
});
