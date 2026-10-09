import { hc } from "hono/client";
import type { AppType } from "@repo/api";

/**
 * 端到端类型安全 RPC（hono/client）：
 * AppType 由 @repo/api 导出（type-only，运行时零依赖），所有路由/参数/响应全程类型检查。
 *
 * 地址分两侧取（同一个 hc 客户端在浏览器与服务端都会用到）：
 */

/** 浏览器侧：构建期内联（NEXT_PUBLIC_* 前缀），必须是**浏览器可达**的地址
 *  （同源部署时形如 https://<域名>/api，见 deploy/Caddyfile）。 */
export const PUBLIC_API_URL =
    process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

/**
 * 服务端（route handler / RSC）用容器内可达地址，可用 API_URL_INTERNAL 覆盖。
 *
 * 为什么必须分开：容器化后服务端**不能**复用上面那个常量——
 *   · 直连模式 http://localhost:3000 → 容器里的 localhost 是 web 容器自己，必然
 *     ECONNREFUSED，表现为登录页永远 503 auth_unavailable；
 *   · 同源模式 https://<域名>/api → 容器内解析公网域名要绕出去再回来（hairpin），
 *     不少环境直接失败。
 * compose 里已给 web 服务注入 API_URL_INTERNAL=http://api:3000（走 compose 网络）。
 */
export const API_URL =
    typeof window === "undefined"
        ? (process.env.API_URL_INTERNAL ?? PUBLIC_API_URL)
        : PUBLIC_API_URL;

export const api = hc<AppType>(API_URL);
