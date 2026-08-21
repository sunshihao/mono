import type { Logger } from "pino";
import type { Hono } from "hono";
import type { Redis } from "ioredis";
import type { Pool } from "pg";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { QdrantClient } from "@qdrant/js-client-rest";
import type { Tracer } from "@opentelemetry/api";
import type {
    AgentMessage,
    AgentState,
    QueryRequest,
    QueryResponse,
    WorkflowGraph,
} from "@repo/types";
import type * as schema from "./db/schema.js";

/**
 * Hono Env 增强：所有中间件/路由通过 c.var 访问。
 * - services: 插件注册表产出的服务映射（key = 插件名；未启用为 null）
 * - requestId / logger: 请求级追踪
 */
export type AppEnv = {
    Bindings: Record<string, unknown>;
    Variables: {
        services: Services;
        requestId: string;
        logger: Logger;
    };
};

/** 提取 Hono 实例的路由 Schema 泛型（AppType 交叉合并用） */
export type SchemaOf<T> = T extends Hono<AppEnv, infer S, string> ? S : never;

/** 各插件暴露的服务形状（插件名与 Services key 一一对应，编译期校验） */
export interface RedisService {
    client: Redis;
}

export interface DbService {
    db: NodePgDatabase<typeof schema>;
    pool: Pool;
}

export interface QdrantService {
    client: QdrantClient;
}

export interface ObservabilityService {
    tracer: Tracer;
    /** 冲刷未上报的 span（停机前调用） */
    flush(): Promise<void>;
}

export interface LangGraphService {
    /** 把可序列化的 WorkflowGraph 编译为可执行图（校验失败抛 ConfigError） */
    compile(graph: WorkflowGraph): unknown;
    /** 编译并以用户问题初始化 AgentState 执行，返回最终 state */
    run(graph: WorkflowGraph, query: string): Promise<AgentState>;
}

export interface LlamaIndexService {
    /** 完整 RAG 管线：嵌入 → Qdrant 检索 → LLM 合成 */
    query(input: QueryRequest): Promise<QueryResponse>;
    /** 纯 LLM 对话（langgraph 的 llm 节点用），返回文本 */
    chat(messages: AgentMessage[]): Promise<string>;
}

/**
 * 静态服务映射：插件集是编译期已知的（一方案件），用显式映射而非模块增强，
 * 插件名/服务类型不匹配会在编译期报错。
 */
export interface Services {
    redis: RedisService | null;
    db: DbService | null;
    qdrant: QdrantService | null;
    observability: ObservabilityService | null;
    langgraph: LangGraphService | null;
    llamaindex: LlamaIndexService | null;
}
