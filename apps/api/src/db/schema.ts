import { jsonb, integer, pgTable, timestamp, uuid, text } from "drizzle-orm/pg-core";
import type { WorkflowGraph } from "@repo/types";

/**
 * 元数据表（里程碑 1 占位）：工作流定义与版本历史。
 * 后续里程碑将补充文档索引状态、ingestion 进度等表。
 */
export const workflows = pgTable("workflows", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  graph: jsonb("graph").notNull().$type<WorkflowGraph>(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workflowVersions = pgTable("workflow_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workflowId: uuid("workflow_id")
    .notNull()
    .references(() => workflows.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  graph: jsonb("graph").notNull().$type<WorkflowGraph>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
