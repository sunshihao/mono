# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state (2026-08-2121)

**里程碑 1 已完成**：pnpm workspace里程碑 2（无已完成：真实检索管线+LangGraph图编译+ingestionweb骨架。技术蓝图见 `planplan.mdmd`，插件开发指南见 `apps/api/README`apps/api/README.md`。

- `apps/api`（`@repo/api`）— Hono API 网关，**框架核心**。LangGraph.js / LlamaIndexTS / Qdrant / Langfuse(OTel) / drizzle+PG / ioredis 一律作为插件挂在 `src/plugins/<name>/`，由 `PluginRegistry` 管理生命周期（topo 排序 → zod 配置校验 → 懒连接 init → 路由 → dispose）。未配置的插件自动降级 disabled（`/readyz` 可见）；`STRICT_INTEGRATIONS=true` 则启动报错。
- `packages/types`（`@repo/types`）— 共享 zod schema/类型：workflow 图、API DTO、AgentState、ingestion 消息信封、RAG 常量（对齐 ../RAG：集合 `knowledgeOfAI`、向量 `text-embedding-v4` 1024 维）。zod schema 是唯一事实源，路由（zValidator）与前端（hono/client + `AppType` from `@repo/api`）复用。
- `apps/web`、`apps/ingestion` 尚未创建（下一期）。`packages/shared-types`/`rag-core`/`db` 计划已由 `@repo/types` 与 `apps/api/src/db` 取代。
- `apps/api`（`@repo/api`）— Hono API 网关，**框架核心**。集成（LangGraph.js / LlamaIndexTS / Qdrant / Langfuse(OTel) / drizzle+PG / ioredis）一律作为插件挂在 `src/plugins/<name>/`，由 `PluginRegistry` 管理生命周期（topo 排序 → zod 配置校验 → 懒连接 init → 路由 → dispose）。未配置的插件自动降级 disabled（`/readyz` 可见）；`STRICT_INTEGRATIONS=true` 则启动报错。
  - **llamaindex 插件 = 真实 RAG 管线**：DashScope `text-embedding-v4`（1024 维）嵌入 → 远程 Qdrant `knowledgeOfAI` 命名向量检索（`client.query` + `using`）→ `qwen-plus` 中文合成（`plugins/llamaindex/pipeline.ts` 纯函数管线，`deps: ["qdrant"]`）。上游失败 → 502；未配置 → 503/stub。
  - **langgraph 插件 = 图编译器**：`WorkflowGraph`（nodes/edges）→ 可执行图（`plugins/langgraph/compiler.ts`；router 出边 `condition` = 路由键，pathFn 取 `state.route ?? state.currentChannel`）；执行入口 `POST /v1/workflows/:id/run`。
- `packages/types`（`@repo/types`）— 共享 zod schema/类型：workflow 图、API DTO（含 RunRequest）、AgentState、ingestion 信封、RAG 常量（集合 `knowledgeOfAI`、向量 `text-embedding-v4` 1024 维，对齐 ../RAG）。zod schema 是唯一事实源。
- `apps/ingestion`（`@repo/ingestion`）— 独立 Node 进程（无插件注册表）：chokidar v5 监听（`INGEST_DIR`）+ Hono webhook（`POST /webhooks/:source`）+ 定时轮询 hash 比对（`doc_hash` sha256），统一 XADD 到 `ingestion:events` Stream；REDIS_URL 缺省 warn + 跳过。端口 3002。
- `apps/web`（`@repo/web`）— Next.js 14.2.35 + @xyflow/react + 手工 shadcn 风格组件。`/` 工作流列表（hc<AppType> 调 /v1/workflows，db 未配置时优雅空态 + 内置 fixtures）+ `/workflows/[id]` React Flow 画布 + 检索面板（调真实管线）。端口 3001。

#### CommandsCommands

```bash```bash
pnpm install      # 安装全部 workspace 依赖
pnpm dev          # types build → 并行启动 api(3000) + ingestion(3002)
pnpm dev:web      # types/api build → web dev(3001)，依赖 api dist（AppType）
pnpm build        # types → api → ingestion → web（顺序保证 dist 就绪）
pnpm typecheck    # 全 workspace tsc --noEmit
pnpm test         # vitest（先构建 types）
pnpm lint         # eslint（flat config，根 eslint.config.js）
```

单包操作：`pnpm --filter @repo/api <script>`；apps/api 另有 `db:generate` / `db:push`（drizzle-kit）。

## Conventions / gotchas

- **ESM NodeNext**：相对导入必须带 `.js` 后缀；`pg` 是 CJS，用 `import pg from "pg"` 取 `Pool`。
- **zod 钉 v3**（LlamaIndexTS peer 依赖）；TS 钉 5.x（typescript-eslint peer `<6.1`，勿升 6/7）。
- **OTel 启动顺序**：`apps/api/src/index.ts` 第一行必须 `import "./telemetry/init.js"`——ESM import 提升会让被插桩模块在 SDK 之前加载。
- 插件契约/新增插件三步见 `apps/api/src/plugins/types.ts` 与 `apps/api/README.md`。
- `.env` 已 gitignore；远程 Qdrant 凭据在 `apps/api/.env`（本地），`qdrant.md` 含密钥已 gitignore。
单包操作：`pnpm --filter <pkg> <script>`；apps/api 另有 `db:generate` / `db:push`（drizzle-kit）。

## Conventions / gotchas

- **ESM NodeNext**：Node 侧（api/ingestion/types）相对导入必须带 `.js` 后缀；`pg` 是 CJS，用 `import pg from "pg"` 取 `Pool`。web 用 bundler resolution（不继承 NodeNext base）。
- **zod 全仓钉 v3**：LlamaIndexTS peer 要求 v3，且 **zod v4 与 @repo/types 的 v3 schema 混用会在运行时崩溃**（`Invalid element at key ... expected a Zod schema`）——新包 `pnpm add zod` 会默认装 v4，必须 `zod@^3`。TS 钉 5.x（typescript-eslint peer `<6.1`）。
- **OTel 启动顺序**：`apps/api/src/index.ts` 第一行必须 `import "./telemetry/init.js"`——ESM import 提升会让被插桩模块在 SDK 之前加载。
- **AppType / hono-client 类型链**（血的教训，改动路由时务必遵守）：
  1. Hono `route()` 的返回 Schema 是 **union**（`MergeSchemaPath | S`），多层叠加后 `keyof` 取交集塌缩成 never——`routes/workflows.ts`/`retrieval.ts` 的 mount 末尾有 cast 成交叉类型的注释说明；
  2. mount 函数的 app 参数必须**泛型化**（`<S extends Schema>(app: Hono<AppEnv, S>)`），写死 `Hono<AppEnv>` 会把上游累积的 Schema 擦成 BlankSchema；
  3. 链式挂载（`.get().post()...`）累积交叉 Schema，副作用挂载不进类型；
  4. 双 zValidator 链（param+json）在 zod-validator 0.9 下类型累积失效——json 校验改 handler 内 `safeParse`；
  5. web 对 `@repo/api` 必须 type-only import（运行时入口会起服务器）。
- 插件契约/新增插件三步见 `apps/api/src/plugins/types.ts` 与 `apps/api/README.md`。
- `.env` 已 gitignore；远程 Qdrant + DashScope 凭据在 `apps/api/.env`（本地），`qdrant.md` 含密钥已 gitignore。注意远程 Qdrant 是明文 HTTP 带 token（客户端会警告 `Api key is used with unsecure connection`），生产需 HTTPS。

## Context

The sibling project `../RAG` is a Python LlamaIndex-based RAG prototype (Qdrant collectioncollection `knowledgeOfAIknowledgeOfAI`, DashScopeDashScope embeddingsembeddings `text-embedding-v4text-embedding-v4` 1024-dim, `qwen-plus` LLM, dedup key `doc_hash` sha256, SentenceSplitter 51250). This monorepo is itsits planned rewrite; before porting more logic（索引写入、增量同步、迁移），check `../RAG` for the reference implementation and data formats — 字段映射见 `packages/types/src/rag.ts`。
