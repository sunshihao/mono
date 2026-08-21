import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { MergeSchemaPath, Schema } from "hono/types";
import { desc, eq } from "drizzle-orm";
import {
    RunRequestSchema,
    WorkflowCreateInputSchema,
    WorkflowGraphSchema,
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
            zValidator<typeof IdParamSchema, "param", AppEnv, string>(
                "param",
                IdParamSchema,
            ),
            async (c) => {
                const dbService = c.var.services.db;
                if (!dbService)
                    return c.json({ error: "workflows_unavailable" }, 503);
                const langgraph = c.var.services.langgraph;
                if (!langgraph)
                    return c.json({ error: "orchestration_unavailable" }, 503);
                // 双 zValidator 链的类型累积在 zod-validator 0.9 下失效，
                // json 校验改在 handler 内手动 parse（契约与 hook 一致）
                const body = RunRequestSchema.safeParse(await c.req.json());
                if (!body.success) {
                    return c.json(
                        {
                            error: "validation_error",
                            issues: body.error.issues,
                        },
                        400,
                    );
                }
                const { id } = c.req.valid("param");
                const [row] = await dbService.db
                    .select()
                    .from(workflows)
                    .where(eq(workflows.id, id))
                    .limit(1);
                if (!row) return c.json({ error: "not_found" }, 404);
                const graph = WorkflowGraphSchema.parse(row.graph);
                const state = await langgraph.run(graph, body.data.query);
                return c.json(state);
            },
        );

    return app.route("/v1/workflows", router) as unknown as Hono<
        AppEnv,
        MergeSchemaPath<SchemaOf<typeof router>, "/v1/workflows"> & S,
        "/"
    >;
}
