import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { MergeSchemaPath, Schema } from "hono/types";
import { desc, eq } from "drizzle-orm";
import {
    RunRequestSchema,
    WorkflowCreateInputSchema,
    WorkflowGraphSchema,
    WorkflowUpdateInputSchema,
    type WorkflowDto,
} from "@repo/types";
import { z } from "zod";
import type { AppEnv, SchemaOf } from "../types.js";
import { workflows, workflowVersions } from "../db/schema.js";

const IdParamSchema = z.object({ id: z.string().uuid() });

function toDto(row: typeof workflows.$inferSelect): WorkflowDto {
    return {
        id: row.id,
        name: row.name,
        graph: row.graph,
        version: row.version,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

/**
 * 工作流元数据 CRUD + 执行（drizzle → PostgreSQL；langgraph 编译执行）。
 * db 插件未配置时返回 503 workflows_unavailable —— 懒连接骨架的标准降级路径。
 *
 * 类型说明：route() 的返回 Schema 是 union（keyof 会塌缩成 never，破坏
 * AppType/hono-client），这里 cast 成交叉类型（与运行时语义一致）。
 * app 参数必须泛型化——写死 Hono<AppEnv> 会把上游累积的 Schema 擦成 BlankSchema。
 */
export function mountWorkflows<S extends Schema>(app: Hono<AppEnv, S>) {
    const router = new Hono<AppEnv>()
        .get("/", async (c) => {
            const dbService = c.var.services.db;
            if (!dbService)
                return c.json({ error: "workflows_unavailable" }, 503);
            const rows = await dbService.db
                .select()
                .from(workflows)
                .orderBy(desc(workflows.createdAt));
            return c.json({ workflows: rows.map(toDto) });
        })
        .post(
            "/",
            zValidator("json", WorkflowCreateInputSchema, (result, c) => {
                if (!result.success) {
                    return c.json(
                        {
                            error: "validation_error",
                            issues: result.error.issues,
                        },
                        400,
                    );
                }
            }),
            async (c) => {
                const dbService = c.var.services.db;
                if (!dbService)
                    return c.json({ error: "workflows_unavailable" }, 503);
                const input = c.req.valid("json");
                const [row] = await dbService.db
                    .insert(workflows)
                    .values({ name: input.name, graph: input.graph })
                    .returning();
                if (!row) return c.json({ error: "insert_failed" }, 500);
                // 每个工作流保留版本历史（编排引擎使用）
                await dbService.db.insert(workflowVersions).values({
                    workflowId: row.id,
                    version: 1,
                    graph: input.graph,
                });
                return c.json(toDto(row), 201);
            },
        )
        .get("/:id", zValidator("param", IdParamSchema), async (c) => {
            const dbService = c.var.services.db;
            if (!dbService)
                return c.json({ error: "workflows_unavailable" }, 503);
            const { id } = c.req.valid("param");
            const [row] = await dbService.db
                .select()
                .from(workflows)
                .where(eq(workflows.id, id))
                .limit(1);
            if (!row) return c.json({ error: "not_found" }, 404);
            return c.json(toDto(row));
        })
        .delete("/:id", zValidator("param", IdParamSchema), async (c) => {
            const dbService = c.var.services.db;
            if (!dbService)
                return c.json({ error: "workflows_unavailable" }, 503);
            const { id } = c.req.valid("param");
            const deleted = await dbService.db
                .delete(workflows)
                .where(eq(workflows.id, id))
                .returning({ id: workflows.id });
            if (deleted.length === 0)
                return c.json({ error: "not_found" }, 404);
            return c.body(null, 204);
        })
        .post(
            "/:id/run",
            // 双 zValidator 链的类型累积在 zod-validator 0.9 下失效：
            // json 走 zValidator（进 AppType/hc 类型），param 在 handler 内 parse
            zValidator("json", RunRequestSchema, (result, c) => {
                if (!result.success) {
                    return c.json(
                        {
                            error: "validation_error",
                            issues: result.error.issues,
                        },
                        400,
                    );
                }
            }),
            async (c) => {
                const dbService = c.var.services.db;
                if (!dbService)
                    return c.json({ error: "workflows_unavailable" }, 503);
                const langgraph = c.var.services.langgraph;
                if (!langgraph)
                    return c.json({ error: "orchestration_unavailable" }, 503);
                // IdParamSchema 是对象 schema，须包成 { id } 再 parse
                const param = IdParamSchema.safeParse({
                    id: c.req.param("id"),
                });
                if (!param.success) {
                    return c.json(
                        {
                            error: "validation_error",
                            issues: param.error.issues,
                        },
                        400,
                    );
                }
                const [row] = await dbService.db
                    .select()
                    .from(workflows)
                    .where(eq(workflows.id, param.data.id))
                    .limit(1);
                if (!row) return c.json({ error: "not_found" }, 404);
                const graph = WorkflowGraphSchema.parse(row.graph);
                const body = c.req.valid("json");
                // 多轮：body.messages 作为历史重放，追加本轮 query
                const state = await langgraph.run(
                    graph,
                    body.query,
                    body.messages,
                );
                return c.json(state);
            },
        )
        .put(
            "/:id",
            // json 走 zValidator（进 AppType/hc 类型），param 在 handler 内 parse（同 run 路由）
            zValidator("json", WorkflowUpdateInputSchema, (result, c) => {
                if (!result.success) {
                    return c.json(
                        {
                            error: "validation_error",
                            issues: result.error.issues,
                        },
                        400,
                    );
                }
            }),
            async (c) => {
                const dbService = c.var.services.db;
                if (!dbService)
                    return c.json({ error: "workflows_unavailable" }, 503);
                const body = c.req.valid("json");
                if (!body.name && !body.graph) {
                    return c.json(
                        {
                            error: "validation_error",
                            issues: [
                                { message: "至少提供 name 或 graph 之一" },
                            ],
                        },
                        400,
                    );
                }
                // IdParamSchema 是对象 schema，须包成 { id } 再 parse
                const param = IdParamSchema.safeParse({
                    id: c.req.param("id"),
                });
                if (!param.success) {
                    return c.json(
                        {
                            error: "validation_error",
                            issues: param.error.issues,
                        },
                        400,
                    );
                }
                const id = param.data.id;
                const [row] = await dbService.db
                    .select()
                    .from(workflows)
                    .where(eq(workflows.id, id))
                    .limit(1);
                if (!row) return c.json({ error: "not_found" }, 404);

                if (body.graph) {
                    // 图更新：version+1 并写入版本历史
                    const newVersion = row.version + 1;
                    const [updated] = await dbService.db
                        .update(workflows)
                        .set({
                            ...(body.name ? { name: body.name } : {}),
                            graph: body.graph,
                            version: newVersion,
                            updatedAt: new Date(),
                        })
                        .where(eq(workflows.id, id))
                        .returning();
                    await dbService.db.insert(workflowVersions).values({
                        workflowId: id,
                        version: newVersion,
                        graph: body.graph,
                    });
                    return c.json(toDto(updated!));
                }
                const [updated] = await dbService.db
                    .update(workflows)
                    .set({ name: body.name!, updatedAt: new Date() })
                    .where(eq(workflows.id, id))
                    .returning();
                return c.json(toDto(updated!));
            },
        )
        .get(
            "/:id/versions",
            zValidator<typeof IdParamSchema, "param", AppEnv, string>(
                "param",
                IdParamSchema,
            ),
            async (c) => {
                const dbService = c.var.services.db;
                if (!dbService)
                    return c.json({ error: "workflows_unavailable" }, 503);
                const { id } = c.req.valid("param");
                const [workflow] = await dbService.db
                    .select()
                    .from(workflows)
                    .where(eq(workflows.id, id))
                    .limit(1);
                if (!workflow) return c.json({ error: "not_found" }, 404);
                const rows = await dbService.db
                    .select()
                    .from(workflowVersions)
                    .where(eq(workflowVersions.workflowId, id))
                    .orderBy(desc(workflowVersions.version));
                return c.json({
                    versions: rows.map((v) => ({
                        id: v.id,
                        workflowId: v.workflowId,
                        version: v.version,
                        graph: v.graph,
                        createdAt: v.createdAt.toISOString(),
                    })),
                });
            },
        );

    return app.route("/v1/workflows", router) as unknown as Hono<
        AppEnv,
        MergeSchemaPath<SchemaOf<typeof router>, "/v1/workflows"> & S,
        "/"
    >;
}
