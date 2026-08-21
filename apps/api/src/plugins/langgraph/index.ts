import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { AgentMessage } from "@repo/types";
import { z } from "zod";
import type { LangGraphService } from "../../types.js";
import type { Plugin } from "../types.js";

/** 无外部配置，始终可用（内存态占位图） */
const ConfigSchema = z.object({});

const StateAnnotation = Annotation.Root({
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

/**
 * LangGraph.js 编排引擎占位：一条 passthrough 编译图。
 * 里程碑 2 将在此把 @repo/types 的 WorkflowGraph（nodes/edges）编译为真实可执行的图。
 */
export const langgraphPlugin: Plugin<LangGraphService> = {
  name: "langgraph",
  version: "0.1.0",
  configSchema: ConfigSchema,
  async init() {
    const graph = new StateGraph(StateAnnotation)
      .addNode("passthrough", (state) => state)
      .addEdge(START, "passthrough")
      .addEdge("passthrough", END)
      .compile();
    return { getGraph: () => graph };
  },
};
