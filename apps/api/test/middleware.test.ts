import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { plugins } from "../src/plugins/index.js";

describe("中间件", () => {
  it("自动生成 x-request-id 并回显", async () => {
    const { app, dispose } = await createApp(plugins, { env: {} });
    const res = await app.request("/healthz");
    const id = res.headers.get("x-request-id");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    await dispose();
  });

  it("透传调用方 x-request-id", async () => {
    const { app, dispose } = await createApp(plugins, { env: {} });
    const res = await app.request("/healthz", { headers: { "x-request-id": "trace-123" } });
    expect(res.headers.get("x-request-id")).toBe("trace-123");
    await dispose();
  });

  it("404 响应同样携带 request-id（错误路径不被旁路）", async () => {
    const { app, dispose } = await createApp(plugins, { env: {} });
    const res = await app.request("/no/such/route");
    expect(res.status).toBe(404);
    expect(res.headers.get("x-request-id")).toBeTruthy();
    await dispose();
  });

  it("CORS 头存在", async () => {
    const { app, dispose } = await createApp(plugins, { env: {} });
    const res = await app.request("/healthz", {
      headers: { origin: "http://localhost:3001" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    await dispose();
  });
});

describe("插件路由（经 getServices 读取服务状态）", () => {
  it("observability 插件路由：未配置 → enabled false", async () => {
    const { app, dispose } = await createApp(plugins, { env: {} });
    const res = await app.request("/v1/observability/status");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ provider: "langfuse", enabled: false });
    await dispose();
  });
});

describe("retrieval 路由降级", () => {
  it("llamaindex 未配置 → stub 响应且契约形状稳定", async () => {
    const { app, dispose } = await createApp(plugins, { env: {} });
    const res = await app.request("/v1/retrieval/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "什么是 RAG？" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      query: "什么是 RAG？",
      answer: null,
      sources: [],
      provider: "stub",
      disabled: true,
    });
    await dispose();
  });
});
