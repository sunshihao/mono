import { Annotation } from "@langchain/langgraph";
import type { AgentMessage } from "@repo/types";

/**
 * AgentState 的 LangGraph channel 结构（与 @repo/types 的 AgentState 对齐）。
 * messages 用 concat reducer：节点返回的消息增量合并进历史。
 */
export const StateAnnotation = Annotation.Root({
    messages: Annotation<AgentMessage[]>({
        reducer: (current, update) => current.concat(update),
        default: () => [],
    }),
    currentChannel: Annotation<string>({
        reducer: (_current, update) => update,
        default: () => "retrieval",
    }),
    route: Annotation<string | undefined>({
        reducer: (current, update) => update ?? current,
        default: () => undefined,
    }),
    workflowId: Annotation<string | undefined>({
        reducer: (current, update) => update ?? current,
        default: () => undefined,
    }),
});
