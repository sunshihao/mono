# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state (2026-08-21)

**阶段三已完成**：数据写入闭环（文件 → 队列 → 向量 → 检索全链路实测通过）。技术蓝图见 `plan.md`，插件开发指南见 `apps/api/README.md`。

- `apps/api`（`@repo/api`）— Hono API 网关，**框架核心**。集成（LangGraph.js / LlamaIndexTS / Qdrant / Langfuse(OTel) / drizzle+PG / ioredis）一律作为插件挂在 `src/plugins/<name>/`，由 `PluginRegistry` 管理生命周期（topo 排序 → zod 配置校验 → 懒连接 init → 路由 → dispose）。未配置的插件自动降级 disabled（`/readyz` 可见）；`STRICT_INTEGRATIONS=true` 则启动报错。
  - **llamaindex 插件 = 真实 RAG 管线**：DashScope `text-embedding-v4`（1024 维）嵌入 → 远程 Qdrant `knowledgeOfAI` 命名向量检索（`client.query` + `using`）→ `qwen-plus` 中文合成（`plugins/llamaindex/pipeline.ts` 纯函数管线，`deps: ["qdrant"]`）。上游失败 → 502；未配置 → 503/stub。
  - **langgraph 插件 = 图编译器**：`WorkflowGraph`（nodes/edges）→ 可执行图（`plugins/langgraph/compiler.ts`；router 出边 `condition` = 路由键，pathFn 取 `state.route ?? state.currentChannel`）；执行入口 `POST /v1/workflows/:id/run`（已端到端实测）。
- `packages/types`（`@repo/types`）— 共享 zod schema/类型：workflow 图、API DTO（含 RunRequest）、AgentState、ingestion 信封、RAG 常量（集合 `knowledgeOfAI`、向量 `text-embedding-v4` 1024 维，对齐 ../RAG）。zod schema 是唯一事实源。
- `apps/ingestion`（`@repo/ingestion`）— 独立 Node 进程（非 Edge）：**生产侧** chokidar v5 监听（`INGEST_DIR`）+ Hono webhook（`POST /webhooks/:source`）+ 定时轮询 hash 比对，统一 XADD 到 `ingestion:events` Stream；**消费侧**（REDIS_URL + QDRANT_URL + OPENAI_API_KEY 齐备时启动）Consumer Group 消费 → 句边界切分（`src/chunk.ts`，512/50）→ 批量嵌入 → Qdrant upsert（`src/indexer.ts`，payload 对齐 ChunkPayload，同 doc_hash 先删后写幂等）。端口 3002。
- `apps/web`（`@repo/web`）— Next.js 14.2.35 + @xyflow/react + 手工 shadcn 风格组件。`/` 工作流列表（hc<AppType> 调 /v1/workflows）+ `/workflows/[id]` React Flow 画布 + 检索面板（调真实管线）。端口 3001。
- **远程基础设施**（凭据在根 `.env` 与各 app `.env`，均已 gitignore）：PG `115.190.209.1:5433/myappdb`（自签证书需 `sslmode=no-verify`，drizzle 表已 push）、Redis `115.190.209.1:6380`（密码含逗号）、Qdrant `115.190.209.1:6333`（明文 HTTP 带 token，客户端会警告）、DashScope。

## Commands

```bash
pnpm install      # 安装全部 workspace 依赖
pnpm dev          # types build → 并行启动 api(3000) + ingestion(3002)
pnpm dev:web      # types/api build → web dev(3001)，依赖 api dist（AppType）
pnpm build        # types → api → ingestion → web（顺序保证 dist 就绪）
pnpm typecheck    # 全 workspace tsc --noEmit
pnpm test         # vitest（先构建 types）
pnpm lint         # eslint（flat config，根 eslint.config.js）
```

单包操作：`pnpm --filter <pkg> <script>`；apps/api 另有 `db:generate` / `db:push`（drizzle-kit，需 DATABASE_URL）。

## Conventions / gotchas

- **ESM NodeNext**：Node 侧（api/ingestion/types）相对导入必须带 `.js` 后缀；`pg` 是 CJS，用 `import pg from "pg"` 取 `Pool`。web 用 bundler resolution（不继承 NodeNext base）。
- **zod 全仓钉 v3**：LlamaIndexTS peer 要求 v3，且 zod v4 与 @repo/types 的 v3 schema 混用会在运行时崩溃——新包 `pnpm add zod` 默认装 v4，必须 `zod@^3`。TS 钉 5.x（typescript-eslint peer `<6.1`）。
- **OTel 启动顺序**：`apps/api/src/index.ts` 第一行必须 `import "./telemetry/init.js"`——ESM import 提升会让被插桩模块在 SDK 之前加载。
- **AppType / hono-client 类型链**（改动路由时务必遵守，详见 routes/*.ts 注释）：
  1. Hono `route()` 的返回 Schema 是 union，多层叠加后 keyof 塌缩成 never——mount 末尾 cast 成交叉类型；
  2. mount 函数的 app 参数必须泛型化（`<S extends Schema>(app: Hono<AppEnv, S>)`），写死 `Hono<AppEnv>` 会把上游 Schema 擦成 BlankSchema；
  3. 链式挂载（`.get().post()...`）累积交叉 Schema；双 zValidator 链（param+json）类型失效——json 校验改 handler 内 `safeParse`；
  4. web 对 `@repo/api` 必须 type-only import（运行时入口会起服务器）。
- **consumer/测试循环**：XREADGROUP 的 fake 不能立即 resolve（微任务空转会饿死事件循环），模拟 BLOCK 要用永不 resolve 的 pending promise。
- 插件契约/新增插件三步见 `apps/api/src/plugins/types.ts` 与 `apps/api/README.md`。

## Context

The sibling project `../RAG` is a Python LlamaIndex-based RAG prototype (Qdrant collection `knowledgeOfAI`, DashScope embeddings `text-embedding-v4` 1024-dim, `qwen-plus` LLM, dedup key `doc_hash` sha256, SentenceSplitter 512/50)。This monorepo is its planned rewrite；字段映射见 `packages/types/src/rag.ts`，写入管线对齐语义见 `apps/ingestion/src/chunk.ts`。
