import { z } from "zod";
import {
    WorkflowDefinitionSchema,
    WorkflowGraphSchema,
    type WorkflowDefinition,
} from "./workflow.js";

/**
 * API 请求/响应 DTO。zod schema 是唯一事实源：
 * apps/api 路由经 @hono/zod-validator 直接复用，apps/web 经 hono/client 复用类型。
 */

export const HealthDtoSchema = z.object({ status: z.literal("ok") });
export type HealthDto = z.infer<typeof HealthDtoSchema>;

export const PluginHealthSchema = z.object({
    name: z.string(),
    status: z.enum(["ready", "disabled", "error"]),
    reason: z.string().optional(),
});
export type PluginHealth = z.infer<typeof PluginHealthSchema>;

/** GET /readyz —— enabled 插件全健康为 ready；有 enabled 插件异常为 degraded（503） */
export const ReadinessDtoSchema = z.object({
    status: z.enum(["ready", "degraded"]),
    plugins: z.array(PluginHealthSchema),
});
export type ReadinessDto = z.infer<typeof ReadinessDtoSchema>;

export const WorkflowCreateInputSchema = z.object({
    name: z.string().min(1).max(200),
    graph: WorkflowGraphSchema,
});
export type WorkflowCreateInput = z.infer<typeof WorkflowCreateInputSchema>;

export type WorkflowDto = WorkflowDefinition;

export const WorkflowListDtoSchema = z.object({
    workflows: z.array(WorkflowDefinitionSchema),
});
export type WorkflowListDto = z.infer<typeof WorkflowListDtoSchema>;

export const SourceRefSchema = z.object({
    file_path: z.string(),
    file_name: z.string(),
    score: z.number().optional(),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

export const QueryRequestSchema = z.object({
    query: z.string().min(1).max(4000),
    topK: z.number().int().min(1).max(50).default(5),
});
export type QueryRequest = z.infer<typeof QueryRequestSchema>;

export const QueryResponseSchema = z.object({
    query: z.string(),
    answer: z.string().nullable(),
    sources: z.array(SourceRefSchema),
    /** stub = 插件未启用时的降级响应；llamaindex = 真实检索管线（里程碑 2） */
    provider: z.enum(["stub", "llamaindex"]),
    disabled: z.boolean().default(false),
});
export type QueryResponse = z.infer<typeof QueryResponseSchema>;

export const ErrorDtoSchema = z.object({
    error: z.string(),
    issues: z.array(z.unknown()).optional(),
});
export type ErrorDto = z.infer<typeof ErrorDtoSchema>;
