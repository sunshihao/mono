# mono — AI 知识库 monorepo（样板框架）

技术蓝图见 [plan.md](plan.md)。当前进度：**阶段三 —— 数据写入闭环已完成**（文件 → 队列 → 向量 → 检索全链路实测）。

## 结构

```
mono/
├── apps/
│   ├── api/          # @repo/api —— Hono API 网关（框架核心，集成一律为插件）
│   ├── ingestion/    # @repo/ingestion —— 摄入服务（生产：chokidar+webhook+轮询 → XADD；消费：切分/嵌入 → Qdrant upsert）
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

## 核心能力

- **数据写入闭环**（阶段三）：文件放入 `INGEST_DIR` → chokidar 事件 → XADD `ingestion:events` → Consumer Group 消费 → 句边界切分（512/50）→ DashScope 批量嵌入 → Qdrant upsert（同 doc_hash 幂等）。
- **真实 RAG 管线**：`POST /v1/retrieval/query` —— 嵌入 → 远程 Qdrant `knowledgeOfAI` 检索 → qwen-plus 中文合成。
- **工作流编排**：`POST /v1/workflows/:id/run` —— PG 中的 `WorkflowGraph` 经 langgraph 插件编译执行（已端到端实测）。
- **摄入三来源**：chokidar / `POST /webhooks/:source` / 定时轮询 hash 比对。
- **端到端类型安全**：`@repo/types` zod schema → api 路由 → `AppType` → web `hc<AppType>`。

## 核心设计

- **Hono 是框架，集成为插件**：LangGraph.js / LlamaIndexTS / Qdrant / Langfuse(OTel) / drizzle+PG / ioredis 均为 `apps/api/src/plugins/<name>/` 下的插件，`PluginRegistry` 统一管理（topo 排序 → zod 配置校验 → 懒连接 init → 路由 → 优雅停机）。
- **懒连接 + 优雅降级**：未配置的插件 `{ disabled, reason }` 降级（`/readyz` 可见）；`STRICT_INTEGRATIONS=true` 启动报错。503 = 集成未配置，502 = 上游调用失败。
- 插件/路由/配置编写指南见 [apps/api/README.md](apps/api/README.md)；环境变量见各 app 的 `.env.example`（真实凭据在各 app `.env`，已 gitignore）。

