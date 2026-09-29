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

/** 固定合法 uuid（param 校验用）—— 不必引入 node:crypto */
const VALID_UUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

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

    it("DELETE /v1/workflows/:id 非法 uuid → 400（param 校验先于集成检查）", async () => {
        const { app, dispose } = await createApp(plugins, { env: {} });
        const res = await app.request("/v1/workflows/not-a-uuid", {
            method: "DELETE",
        });
        expect(res.status).toBe(400);
        // 该路由的 zValidator 没有自定义 hook，失败时吐的是 zod 原始 SafeParseError
        // （{ success: false, error: { issues } }），**不是** ErrorDtoSchema ——
        // 与 POST 那条不同（POST 路由自带 error hook），故这里只断言 success 标记。
        const body = (await res.json()) as { success: boolean };
        expect(body.success).toBe(false);
        await dispose();
    });

    it("DELETE /v1/workflows/:id 校验通过但 db 未配置 → 503 workflows_unavailable", async () => {
        const { app, dispose } = await createApp(plugins, { env: {} });
        const res = await app.request(`/v1/workflows/${VALID_UUID}`, {
            method: "DELETE",
        });
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ error: "workflows_unavailable" });
        await dispose();
    });
});
