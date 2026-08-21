import { describe, expect, it } from "vitest";
import { ErrorDtoSchema } from "@repo/types";
import { createApp } from "../src/app.js";
import { plugins } from "../src/plugins/index.js";

const validBody = {
    name: "知识问答",
    graph: {
        nodes: [
            { id: "n1", type: "start", config: {} },
            { id: "n2", type: "end", config: {} },
        ],
        edges: [{ id: "e1", source: "n1", target: "n2" }],
    },
};

describe("workflows 路由（db 插件未配置的降级路径）", () => {
    it("GET /v1/workflows → 503 workflows_unavailable", async () => {
        const { app, dispose } = await createApp(plugins, { env: {} });
        const res = await app.request("/v1/workflows");
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ error: "workflows_unavailable" });
        await dispose();
    });

    it("POST 校验失败 → 400 validation_error（zod schema 复用自 @repo/types）", async () => {
        const { app, dispose } = await createApp(plugins, { env: {} });
        const res = await app.request("/v1/workflows", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "", graph: { nodes: [], edges: [] } }),
        });
        expect(res.status).toBe(400);
        const body = ErrorDtoSchema.parse(await res.json());
        expect(body.error).toBe("validation_error");
        expect(body.issues?.length ?? 0).toBeGreaterThan(0);
        await dispose();
    });

    it("POST 校验通过但 db 未配置 → 503（校验先于集成检查）", async () => {
        const { app, dispose } = await createApp(plugins, { env: {} });
        const res = await app.request("/v1/workflows", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(validBody),
        });
        expect(res.status).toBe(503);
        await dispose();
    });

    it("GET /v1/workflows/:id 非法 uuid → 400", async () => {
        const { app, dispose } = await createApp(plugins, { env: {} });
        const res = await app.request("/v1/workflows/not-a-uuid");
        expect(res.status).toBe(400);
        await dispose();
    });
});
