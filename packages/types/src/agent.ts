import { z } from "zod";

/** Agent 消息（LangGraph messages channel 的元素） */
export const AgentMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
  toolCallId: z.string().optional(),
  name: z.string().optional(),
});
export type AgentMessage = z.infer<typeof AgentMessageSchema>;

/**
 * Agent State —— LangGraph StateGraph 的 channel 结构。
 * langgraph 插件将以此构建编译图；reducer/default 语义见 langgraph 的 Annotation。
 */
export const AgentStateSchema = z.object({
  messages: z.array(AgentMessageSchema).default([]),
  currentChannel: z.string().default("retrieval"),
  route: z.string().optional(),
  workflowId: z.string().uuid().optional(),
});
export type AgentState = z.infer<typeof AgentStateSchema>;
