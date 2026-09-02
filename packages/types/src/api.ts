import { z } from "zod";
import { AgentMessageSchema } from "./agent.js";
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

/** PUT /v1/workflows/:id —— 至少更新一个字段；graph 更新时 version+1 并写版本历史 */
export const WorkflowUpdateInputSchema = z.object({
    name: z.string().min(1).max(200).optional(),
    graph: WorkflowGraphSchema.optional(),
});
export type WorkflowUpdateInput = z.infer<typeof WorkflowUpdateInputSchema>;

export type WorkflowDto = WorkflowDefinition;

export const WorkflowListDtoSchema = z.object({
    workflows: z.array(WorkflowDefinitionSchema),
});
export type WorkflowListDto = z.infer<typeof WorkflowListDtoSchema>;

/** 工作流版本历史条目 */
export const WorkflowVersionDtoSchema = z.object({
    id: z.string().uuid(),
    workflowId: z.string().uuid(),
    version: z.number().int().positive(),
    graph: WorkflowGraphSchema,
    createdAt: z.string().datetime(),
});
export type WorkflowVersionDto = z.infer<typeof WorkflowVersionDtoSchema>;

export const WorkflowVersionListDtoSchema = z.object({
    versions: z.array(WorkflowVersionDtoSchema),
});
export type WorkflowVersionListDto = z.infer<
    typeof WorkflowVersionListDtoSchema
>;

export const SourceRefSchema = z.object({
    file_path: z.string(),
    file_name: z.string(),
    score: z.number().optional(),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

export const QueryRequestSchema = z.object({
    query: z.string().min(1).max(4000),
    topK: z.number().int().min(1).max(50).default(5),
    /** 可选附加能力：知识库合成时注入技能指令（skillId）或外部工具返回（mcpToolId） */
    skillId: z.string().uuid().optional(),
    mcpToolId: z.string().uuid().optional(),
});
export type QueryRequest = z.infer<typeof QueryRequestSchema>;

/**
 * POST /v1/workflows/:id/run —— 以用户问题（+ 可选历史消息）初始化 AgentState 并执行编译图。
 * messages 携带前几轮对话可实现多轮编排（与 checkpointer 的 thread 续跑互补）。
 */
export const RunRequestSchema = z.object({
    query: z.string().min(1).max(4000),
    messages: z.array(AgentMessageSchema).max(50).optional(),
});
export type RunRequest = z.infer<typeof RunRequestSchema>;

export const QueryResponseSchema = z.object({
    query: z.string(),
    answer: z.string().nullable(),
    sources: z.array(SourceRefSchema),
    /** stub = 插件未启用时的降级响应；llamaindex = 真实检索管线（里程碑 2） */
    provider: z.enum(["stub", "llamaindex"]),
    disabled: z.boolean().default(false),
    /** 附加能力应用情况（携带 skillId/mcpToolId 请求时返回） */
    enhancement: z
        .object({
            skillName: z.string().nullable(),
            mcpName: z.string().nullable(),
            warning: z.string().nullable(),
        })
        .optional(),
});
export type QueryResponse = z.infer<typeof QueryResponseSchema>;

/**
 * 纯检索响应（外部 LLM / MCP 的上下文供给）：不合成答案，
 * 只返回命中的上下文块与来源，由调用方自己的模型消费。
 */
export const SearchResultSchema = z.object({
    text: z.string(),
    file_path: z.string(),
    file_name: z.string(),
    doc_hash: z.string(),
    score: z.number(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const SearchResponseSchema = z.object({
    query: z.string(),
    results: z.array(SearchResultSchema),
    provider: z.enum(["stub", "llamaindex"]),
    disabled: z.boolean().default(false),
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

export const ErrorDtoSchema = z.object({
    error: z.string(),
    issues: z.array(z.unknown()).optional(),
});
export type ErrorDto = z.infer<typeof ErrorDtoSchema>;

/** POST /v1/auth/login —— 登录请求体（密码 scrypt 哈希校验） */
export const LoginRequestSchema = z.object({
    username: z.string().trim().min(1).max(64),
    password: z.string().min(1).max(128),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/** POST /v1/auth/login —— 登录成功响应 */
export const LoginResponseDtoSchema = z.object({
    user: z.object({
        id: z.number().int().positive(),
        username: z.string(),
    }),
});
export type LoginResponseDto = z.infer<typeof LoginResponseDtoSchema>;

/**
 * Skill（提示词型技能，设置页配置、工作流 skill 节点经 config.refId 引用）。
 * prompt 在节点执行时作为 system 指令注入 LLM。
 */
export const SkillCreateInputSchema = z.object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).optional(),
    prompt: z.string().trim().min(1).max(4000),
});
export type SkillCreateInput = z.infer<typeof SkillCreateInputSchema>;

export const SkillUpdateInputSchema = SkillCreateInputSchema.partial().extend({
    enabled: z.boolean().optional(),
});
export type SkillUpdateInput = z.infer<typeof SkillUpdateInputSchema>;

export const SkillDtoSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    prompt: z.string(),
    enabled: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
});
export type SkillDto = z.infer<typeof SkillDtoSchema>;

export const SkillListDtoSchema = z.object({
    skills: z.array(SkillDtoSchema),
});
export type SkillListDto = z.infer<typeof SkillListDtoSchema>;

/**
 * McpTool（外部工具端点注册：把 MCP/外部服务工具声明为 HTTP 调用，
 * 工作流 mcp 节点经 config.refId 引用；url 支持 {query} 占位符）。
 */
export const McpToolCreateInputSchema = z.object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).optional(),
    method: z.enum(["GET", "POST"]).default("GET"),
    url: z.string().trim().url().max(2000),
});
export type McpToolCreateInput = z.infer<typeof McpToolCreateInputSchema>;

export const McpToolUpdateInputSchema =
    McpToolCreateInputSchema.partial().extend({
        enabled: z.boolean().optional(),
    });
export type McpToolUpdateInput = z.infer<typeof McpToolUpdateInputSchema>;

export const McpToolDtoSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    method: z.enum(["GET", "POST"]),
    url: z.string(),
    enabled: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
});
export type McpToolDto = z.infer<typeof McpToolDtoSchema>;

export const McpToolListDtoSchema = z.object({
    tools: z.array(McpToolDtoSchema),
});
export type McpToolListDto = z.infer<typeof McpToolListDtoSchema>;
