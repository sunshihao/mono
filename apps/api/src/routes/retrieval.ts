import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { QueryRequestSchema, type QueryResponse } from "@repo/types";
import type { AppEnv } from "../types.js";

/**
 * 检索查询入口（llamaindex 插件）。
 * 插件未启用时返回契约形状稳定的 stub 响应 —— 前端无需感知后端集成状态。
 */
export function mountRetrieval(app: Hono<AppEnv>): void {
  const retrievalRouter = new Hono<AppEnv>();

  retrievalRouter.post(
    "/query",
    zValidator("json", QueryRequestSchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: "validation_error", issues: result.error.issues }, 400);
      }
    }),
    async (c) => {
      const input = c.req.valid("json");
      const llamaindex = c.var.services.llamaindex;
      if (!llamaindex) {
        const stub: QueryResponse = {
          query: input.query,
          answer: null,
          sources: [],
          provider: "stub",
          disabled: true,
        };
        return c.json(stub);
      }
      return c.json(await llamaindex.query(input));
    }
  );

  app.route("/v1/retrieval", retrievalRouter);
}
