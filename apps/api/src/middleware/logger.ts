import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import type { AppEnv } from "../types.js";

/** 请求级子 logger（绑定 requestId），并记录每次请求的访问日志。须在 requestId 之后注册。 */
export function requestLogger(logger: Logger): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const start = Date.now();
    c.set("logger", logger.child({ requestId: c.get("requestId") }));
    await next();
    c.var.logger.info(
      { method: c.req.method, path: c.req.path, status: c.res.status, durationMs: Date.now() - start },
      "request completed"
    );
  };
}
