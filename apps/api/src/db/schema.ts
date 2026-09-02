import {
    bigint,
    boolean,
    date,
    jsonb,
    integer,
    pgTable,
    timestamp,
    uuid,
    text,
    varchar,
} from "drizzle-orm/pg-core";
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
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
});

export const workflowVersions = pgTable("workflow_versions", {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id")
        .notNull()
        .references(() => workflows.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    graph: jsonb("graph").notNull().$type<WorkflowGraph>(),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
});

/**
 * 登录账号表（远程 PG 手工创建，此处定义仅用于 drizzle 类型与查询，
 * 结构与线上表严格一致：id 无默认值/无序列，插入必须显式提供。
 * 切勿对这张表运行 db:push —— 表已存在，push 会产生 alter/重建风险）。
 */
export const users = pgTable("user", {
    id: bigint("id", { mode: "number" }).primaryKey(),
    uuid: varchar("uuid").notNull(),
    username: varchar("username").notNull(),
    password: varchar("password").notNull(),
    phone: varchar("phone"),
    email: varchar("email"),
    phoneVerified: boolean("phone_verified"),
    emailVerified: boolean("email_verified"),
    loginFailCount: integer("login_fail_count"),
    lastLoginIp: varchar("last_login_ip"),
    lastLoginAt: date("last_login_at", { mode: "date" }),
    passwordUpdatedAt: date("password_updated_at", { mode: "date" }),
    createdAt: date("created_at", { mode: "date" }),
    updatedAt: date("updated_at", { mode: "date" }),
    status: integer("status").notNull(),
});

/** 提示词型技能（设置页配置；工作流 skill 节点经 config.refId 引用） */
export const skills = pgTable("skills", {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    prompt: text("prompt").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
});

/** 外部工具端点注册（设置页配置；工作流 mcp 节点经 config.refId 引用） */
export const mcpTools = pgTable("mcp_tools", {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    method: text("method").notNull(),
    url: text("url").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
});
