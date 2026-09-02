import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { MergeSchemaPath, Schema } from "hono/types";
import { desc, eq } from "drizzle-orm";
import {
    SkillCreateInputSchema,
    SkillUpdateInputSchema,
    type SkillDto,
} from "@repo/types";
import { z } from "zod";
import type { AppEnv, SchemaOf } from "../types.js";
import { skills } from "../db/schema.js";

const IdParamSchema = z.object({ id: z.string().uuid() });

function toDto(row: typeof skills.$inferSelect): SkillDto {
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        prompt: row.prompt,
        enabled: row.enabled,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

/**
 * Skill CRUD（提示词型技能注册表，工作流 skill 节点经 config.refId 引用）。
 * 类型链约定同 workflows.ts：泛型化 + 末尾 cast 交叉类型。
 */
export function mountSkills<S extends Schema>(app: Hono<AppEnv, S>) {
    const router = new Hono<AppEnv>()
        .get("/", async (c) => {
            const dbService = c.var.services.db;
            if (!dbService) return c.json({ error: "skills_unavailable" }, 503);
            const rows = await dbService.db
                .select()
                .from(skills)
                .orderBy(desc(skills.createdAt));
            return c.json({ skills: rows.map(toDto) });
        })
        .post(
            "/",
            zValidator("json", SkillCreateInputSchema, (result, c) => {
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
                if (!dbService) return c.json({ error: "skills_unavailable" }, 503);
                const input = c.req.valid("json");
                const [row] = await dbService.db
                    .insert(skills)
                    .values({
                        name: input.name,
                        description: input.description ?? null,
                        prompt: input.prompt,
                    })
                    .returning();
                if (!row) return c.json({ error: "insert_failed" }, 500);
                return c.json(toDto(row), 201);
            },
        )
        .put(
            "/:id",
            // 双 zValidator（param+json）类型链失效：json 走 zValidator，param 在 handler 内 parse
            zValidator("json", SkillUpdateInputSchema, (result, c) => {
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
                if (!dbService) return c.json({ error: "skills_unavailable" }, 503);
                const body = c.req.valid("json");
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
                const set: Partial<typeof skills.$inferInsert> = {
                    updatedAt: new Date(),
                };
                if (body.name !== undefined) set.name = body.name;
                if (body.description !== undefined)
                    set.description = body.description ?? null;
                if (body.prompt !== undefined) set.prompt = body.prompt;
                if (body.enabled !== undefined) set.enabled = body.enabled;
                const [row] = await dbService.db
                    .update(skills)
                    .set(set)
                    .where(eq(skills.id, param.data.id))
                    .returning();
                if (!row) return c.json({ error: "not_found" }, 404);
                return c.json(toDto(row));
            },
        )
        .delete("/:id", async (c) => {
            const dbService = c.var.services.db;
            if (!dbService) return c.json({ error: "skills_unavailable" }, 503);
            const param = IdParamSchema.safeParse({
                id: c.req.param("id"),
            });
            if (!param.success) {
                return c.json(
                    { error: "validation_error", issues: param.error.issues },
                    400,
                );
            }
            const deleted = await dbService.db
                .delete(skills)
                .where(eq(skills.id, param.data.id))
                .returning({ id: skills.id });
            if (deleted.length === 0) return c.json({ error: "not_found" }, 404);
            return c.body(null, 204);
        });

    return app.route("/v1/skills", router) as unknown as Hono<
        AppEnv,
        MergeSchemaPath<SchemaOf<typeof router>, "/v1/skills"> & S,
        "/"
    >;
}
