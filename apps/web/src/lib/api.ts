import { hc } from "hono/client";
import type { AppType } from "@repo/api";

/**
 * 端到端类型安全 RPC（hono/client）：
 * AppType 由 @repo/api 导出（type-only，运行时零依赖），所有路由/参数/响应全程类型检查。
 */
export const API_URL =
    process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export const api = hc<AppType>(API_URL);
