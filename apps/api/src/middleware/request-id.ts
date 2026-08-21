import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types.js";

/** 透传或生成请求 ID，写入响应头与 c.var.requestId */
export function requestId(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const id = c.req.header("x-request-id") ?? randomUUID();
    c.set("requestId", id);
    c.header("x-request-id", id);
    await next();
  };
}
