# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state (2026-08-22)

**阶段五已完成**：可观测性与生产化（业务埋点 + 检索缓存 + PubSub + 数据源适配器 + Docker 部署化）。plan.md 蓝图全部落地。技术蓝图见 `plan.md`，插件开发指南见 `apps/api/README.md`。

- `apps/api`（`@repo/api`）— Hono API 网关，**框架核心**。集成（LangGraph.js / LlamaIndexTS / Qdrant / Langfuse(OTel) / drizzle+PG / ioredis）一律作为插件挂在 `src/plugins/<name>/`，由 `PluginRegistry` 管理生命周期（topo 排序 → zod 配置校验 → 懒连接 init → 路由 → dispose）。未配置的插件自动降级 disabled（`/readyz` 可见）；`STRICT_INTEGRATIONS=true` 则启动报错。
  - **llamaindex 插件 = 真实 RAG 管线 + 缓存**：DashScope `text-embedding-v4`（1024 维）嵌入 → 远程 Qdrant `knowledgeOfAI` 命名向量检索（`client.query` + `using`）→ `qwen-plus` 中文合成（`plugins/llamaindex/pipeline.ts` 纯函数管线，`deps: ["qdrant", "redis"]`）。上游失败 → 502；未配置 → 503/stub。redis 就绪时响应缓存（`rag:cache:{sha256}`，RAG_CACHE_TTL 秒，实测 80 倍加速）。
  - **langgraph 插件 = 图编译器**：`WorkflowGraph`（nodes/edges）→ 可执行图（`plugins/langgraph/compiler.ts`；router 出边 `condition` = 路由键，pathFn 取 `state.route ?? state.currentChannel`）；**MemorySaver checkpointer** + **多轮历史重放**；执行入口 `POST /v1/workflows/:id/run`（body 可带 messages）。
  - **工作流 CRUD 完整**：POST 创建 / GET 列表 / GET 详情 / PUT 更新（改图时 version+1 并写 `workflow_versions` 历史）/ DELETE / GET `/:id/versions` 版本历史。
  - **业务埋点**：RAG 管线（rag.pipeline/embed/search/synthesize 子 span + 属性）、llm.chat、langgraph 节点均打 OTel span（`trace.getTracer` 全局 no-op 安全）；LANGFUSE 密钥配好后经 telemetry/init 自动上报 Langfuse。
- `packages/types`（`@repo/types`）— 共享 zod schema/类型：workflow 图、API DTO（含 RunRequest/Update/Version）、AgentState、ingestion 信封、RAG 常量（对齐 ../RAG）。zod schema 是唯一事实源。
- `apps/ingestion`（`@repo/ingestion`）— 独立 Node 进程（非 Edge）：**生产侧** chokidar v5 监听 + Hono webhook + 定时轮询 hash 比对，统一 XADD 到 `ingestion:events` Stream；**消费侧**（REDIS_URL + QDRANT_URL + OPENAI_API_KEY 齐备时启动）Consumer Group 消费 → 切分（512/50）→ 批量嵌入 → Qdrant upsert（同 doc_hash 先删后写幂等）。端口 3002。
- `apps/data`（`@repo/data`）— **多 Git 仓库 → 多向量库增量同步系统**（设计蓝图见该目录 README 与根目录 `apps/data` 设计说明）。`sync.config.yaml`（env:VAR 注入）为仓库↔collection 映射唯一真源；每仓库一条 Redis Stream（`data-sync:<repo>`）+ SET NX 消费租约（per-repo FIFO + 水平扩展）。webhook（3003，HMAC 每仓库 secret）→ worker → `git diff <state.sha|空树> <after>`（A/M/D/R 分类）→ 切块（auto/markdown/code/fixed）→ DashScope 嵌入 → Qdrant upsert（point id = sha256(repo:file_path:chunk_index) 转 UUID，幂等；M 差集删除、R 向量搬运）。state（`.sync-state/<repo>.state.json`）仅在全部写成功后推进；失败经 ZSET 延迟队列指数退避重试 → DLQ 流；reconcile 定时对账兜底。CLI：`sync/backfill/cleanup/status/config-check/reconcile/worker/webhook/serve`（`--dry-run` 全链路预览）。仅接 `repos/chinese-buy-us-stock-guide`（AIGC-Interview-Book 暂缓）。
- `apps/web`（`@repo/web`）— Next.js 14.2.35 + @xyflow/react + 手工 shadcn 风格组件。`/` 工作流列表 + 新建入口；`/workflows/[id]` **可编辑画布**（增删 5 类节点/连线/router 条件边/重命名）→ 保存（PUT）→ 版本历史浏览 + **多轮运行面板**（携带 messages 重放）；检索面板（真实管线）。端口 3001。
- **远程基础设施**（凭据在根 `.env` 与各 app `.env`，均已 gitignore）：PG `115.190.209.1:5433/myappdb`（自签证书需 `sslmode=no-verify`，drizzle 表已 push）、Redis `115.190.209.1:6380`（密码含逗号）、Qdrant `115.190.209.1:6333`（明文 HTTP 带 token）、DashScope。

## Commands

```bash
pnpm install      # 安装全部 workspace 依赖
pnpm dev          # types build → 并行启动 api(3000) + ingestion(3002)
pnpm dev:web      # types/api build → web dev(3001)，依赖 api dist（AppType）
pnpm build        # types → api → ingestion → data → web（顺序保证 dist 就绪）
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
- **OTel SDK 2.x 与 api 1.9 的埋点坑**（见 test/instrumentation.test.ts 注释）：
  1. `startActiveSpan` **不再自动 end**——所有 span 必须在 finally 显式 `span.end()`（本仓埋点代码已遵守）；
  2. InMemorySpanExporter 对 async startActiveSpan 的导出时序不稳定，且 **parent 链会断**——测试用记录型 SpanProcessor（onEnd 捕获 ReadableSpan）断言 span 名/属性/事件，不断言 parent 与导出；
  3. 模块级 `trace.getTracer` 的 ProxyTracer 会**缓存 delegate**——测试中切换 provider 需用 beforeAll 单 provider，否则 span 发往已 shutdown 的旧实例；
  4. api 的 `Span` 接口没有 `name/attributes`（SDK 侧 `ReadableSpan` 才有）；SDK 2.x 的 processor 走构造参数 `{ spanProcessors }`（`addSpanProcessor` 已移除）。
  生产 Langfuse 上报需真实密钥实测（埋点代码已就绪，配好 LANGFUSE_* 即自动上报）。
- 插件契约/新增插件三步见 `apps/api/src/plugins/types.ts` 与 `apps/api/README.md`。

## Context

The sibling project `../RAG` is a Python LlamaIndex-based RAG prototype (Qdrant collection `knowledgeOfAI`, DashScope embeddings `text-embedding-v4` 1024-dim, `qwen-plus` LLM, dedup key `doc_hash` sha256, SentenceSplitter 512/50)。This monorepo is its planned rewrite；字段映射见 `packages/types/src/rag.ts`，写入管线对齐语义见 `apps/ingestion/src/chunk.ts`。
