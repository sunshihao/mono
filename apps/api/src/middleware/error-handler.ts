import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import type { AppEnv } from "../types.js";

/**
 * 统一错误响应：
 *  - HTTPException → 原样返回（@hono/zod-validator 默认抛 400 也走这里）
 *  - ZodError → 400 + 结构化 issues
 *  - 其余 → 500，详情只进日志不外泄
 */
export function errorHandler(err: Error, c: Context<AppEnv>): Response {
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  if (err instanceof ZodError) {
    return c.json(
      {
        error: "validation_error",
        issues: err.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      },
      400
    );
  }
  c.var.logger.error({ err }, "unhandled error");
  return c.json({ error: "internal_error" }, 500);
}
