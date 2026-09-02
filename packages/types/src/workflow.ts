import { z } from "zod";

/** 工作流图（LangGraph 可序列化形式：节点 + 边），持久化于 PostgreSQL（drizzle） */
// skill = 引用 skills 表（提示词型，config.refId）；mcp = 引用 mcp_tools 表（HTTP 端点工具，config.refId）
export const WorkflowNodeTypeSchema = z.enum([
    "start",
    "llm",
    "retrieve",
    "router",
    "skill",
    "mcp",
    "end",
]);
export type WorkflowNodeType = z.infer<typeof WorkflowNodeTypeSchema>;

export const WorkflowNodeSchema = z.object({
    id: z.string().min(1),
    type: WorkflowNodeTypeSchema,
    label: z.string().optional(),
    /** 节点级配置（模型名、检索集合、路由条件等），结构随 type 演进 */
    config: z.record(z.string(), z.unknown()).default({}),
});
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

export const WorkflowEdgeSchema = z.object({
    id: z.string().min(1),
    source: z.string().min(1),
    target: z.string().min(1),
    /** 路由边条件表达式（router 节点出边） */
    condition: z.string().optional(),
});
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

export const WorkflowGraphSchema = z.object({
    nodes: z.array(WorkflowNodeSchema),
    edges: z.array(WorkflowEdgeSchema),
});
export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>;

export const WorkflowDefinitionSchema = z.object({
    id: z.string().uuid(),
    name: z.string().min(1).max(200),
    version: z.number().int().positive().default(1),
    graph: WorkflowGraphSchema,
    createdAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime().optional(),
});
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;
