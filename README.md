# mono — AI 知识库 monorepo（样板框架）

技术蓝图见 [plan.md](plan.md)。当前进度：**里程碑 2 —— 真实检索管线 + LangGraph 编排 + 三端骨架**。

## 结构

```
mono/
├── apps/
│   ├── api/          # @repo/api —— Hono API 网关（框架核心，集成一律为插件）
│   ├── ingestion/    # @repo/ingestion —— 摄入服务（chokidar + webhook + 轮询 → XADD）
│   └── web/          # @repo/web —— Next 14 + React Flow + shadcn 风格组件
└── packages/
    └── types/        # @repo/types —— 共享 zod schema + 类型（唯一事实源）
```

## 常用命令

| 命令 | 说明 |
|---|---|
| `pnpm install` | 安装全部 workspace 依赖 |
| `pnpm dev` | types 构建后并行启动 api(3000) + ingestion(3002) |
| `pnpm dev:web` | 构建 types/api 后启动 web(3001) |
| `pnpm build` | types → api → ingestion → web |
| `pnpm typecheck` / `pnpm test` / `pnpm lint` | 全仓类型检查 / 测试 / 检查 |

## 核心能力（里程碑 2）

- **真实 RAG 管线**：`POST /v1/retrieval/query` —— DashScope 嵌入 → 远程 Qdrant `knowledgeOfAI`（2000 点）检索 → qwen-plus 中文合成，返回答案 + 带分数的来源。
- **工作流编排**：`POST /v1/workflows/:id/run` —— db 中的 `WorkflowGraph` 经 langgraph 插件编译执行（节点类型 start/llm/retrieve/router/end；router 出边 `condition` 即路由键）。
- **摄入三来源**：chokidar 文件监听（内容 hash 去重）、`POST /webhooks/:source`、定时轮询 hash 比对，统一 XADD 到 Redis Stream `ingestion:events`。
- **端到端类型安全**：`@repo/types` zod schema → api 路由校验 → `AppType`（@repo/api 导出）→ web `hc<AppType>`，全程类型检查。

## 核心设计（沿用里程碑 1）

- **Hono 是框架，集成为插件**：LangGraph.js / LlamaIndexTS / Qdrant / Langfuse(OTel) / drizzle+PG / ioredis 均为 `apps/api/src/plugins/<name>/` 下的插件，`PluginRegistry` 统一管理（topo 排序 → zod 配置校验 → 懒连接 init → 路由 → 优雅停机）。
- **懒连接 + 优雅降级**：未配置的插件 `{ disabled, reason }` 降级（`/readyz` 可见）；`STRICT_INTEGRATIONS=true` 启动报错。503 = 集成未配置，502 = 上游调用失败。
- 插件/路由/配置编写指南见 [apps/api/README.md](apps/api/README.md)；环境变量见各 app 的 `.env.example`（api 的 `.env` 含远程 Qdrant 与 DashScope 凭据，已 gitignore）。
