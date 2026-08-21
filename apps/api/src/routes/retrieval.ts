import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { MergeSchemaPath, Schema } from "hono/types";
import { QueryRequestSchema, type QueryResponse } from "@repo/types";
import type { AppEnv, SchemaOf } from "../types.js";

/**
 * 检索查询入口（llamaindex 插件）。
 * 插件未启用时返回契约形状稳定的 stub 响应；启用时走真实管线，
 * 上游失败由管线抛 502（errorHandler 透传）。
 *
 * 类型说明同 workflows.ts：route() 的 union 返回被 cast 成交叉；
 * app 参数必须泛型化以保留上游累积的 Schema。
 */
export function mountRetrieval<S extends Schema>(app: Hono<AppEnv, S>) {
    const router = new Hono<AppEnv>().post(
        "/query",
        zValidator("json", QueryRequestSchema, (result, c) => {
            if (!result.success) {
                return c.json(
                    { error: "validation_error", issues: result.error.issues },
                    400,
                );
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
        },
    );

    return app.route("/v1/retrieval", router) as unknown as Hono<
        AppEnv,
        MergeSchemaPath<SchemaOf<typeof router>, "/v1/retrieval"> & S,
        "/"
    >;
}
