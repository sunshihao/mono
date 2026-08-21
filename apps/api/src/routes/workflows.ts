import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { desc, eq } from "drizzle-orm";
import { WorkflowCreateInputSchema, type WorkflowDto } from "@repo/types";
import { z } from "zod";
import type { AppEnv } from "../types.js";
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
 * 工作流元数据 CRUD（drizzle → PostgreSQL）。
 * db 插件未配置时返回 503 workflows_unavailable —— 这是懒连接骨架的标准降级路径。
 */
export function mountWorkflows(app: Hono<AppEnv>): void {
    const workflowsRouter = new Hono<AppEnv>();

    workflowsRouter.get("/", async (c) => {
        const dbService = c.var.services.db;
        if (!dbService) return c.json({ error: "workflows_unavailable" }, 503);
        const rows = await dbService.db
            .select()
            .from(workflows)
            .orderBy(desc(workflows.createdAt));
        return c.json({ workflows: rows.map(toDto) });
    });

    workflowsRouter.post(
        "/",
        zValidator("json", WorkflowCreateInputSchema, (result, c) => {
            if (!result.success) {
                return c.json(
                    { error: "validation_error", issues: result.error.issues },
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
            // 每个工作流保留版本历史（编排引擎里程碑使用）
            await dbService.db
                .insert(workflowVersions)
                .values({ workflowId: row.id, version: 1, graph: input.graph });
            return c.json(toDto(row), 201);
        },
    );

    workflowsRouter.get(
        "/:id",
        zValidator("param", IdParamSchema),
        async (c) => {
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
        },
    );

    workflowsRouter.delete(
        "/:id",
        zValidator("param", IdParamSchema),
        async (c) => {
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
        },
    );

    app.route("/v1/workflows", workflowsRouter);
}
