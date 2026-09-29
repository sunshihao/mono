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

/**
 * retrieve 节点的 config（画布写入、langgraph 编译器读取）。
 *
 * config 本身仍是开放的 record（见上），这是给编译器用的类型化解析入口：
 * 用 safeParse 拿默认值，非法就整体退回默认而非抛错（与编译器"软失败"约定一致）。
 *
 * topK 用 coerce：config 的值来自 z.unknown()，手改过的图可能存成字符串。
 */
export const RetrieveNodeConfigSchema = z.object({
    topK: z.coerce.number().int().min(1).max(50).default(5),
    /** 附加技能：合成时以 system 指令注入（对齐知识库 tab 的同名能力） */
    skillId: z.string().uuid().optional(),
    /** 附加工具：其返回并入合成上下文 */
    mcpToolId: z.string().uuid().optional(),
});
export type RetrieveNodeConfig = z.infer<typeof RetrieveNodeConfigSchema>;

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
