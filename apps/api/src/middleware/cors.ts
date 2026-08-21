import { cors } from "hono/cors";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types.js";

/** CORS（开发默认全开；生产部署时收紧 origin） */
export function corsMiddleware(): MiddlewareHandler<AppEnv> {
  return cors({ origin: "*" });
}
