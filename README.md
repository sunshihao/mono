# mono — AI 知识库 monorepo（样板框架）

技术蓝图见 [plan.md](plan.md)。当前进度：**阶段四 —— 编排与工作流端到端已完成**（版本历史 + 画布编辑 + 多轮执行全链路实测）。

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

- **数据写入闭环**：文件放入 `INGEST_DIR` → chokidar 事件 → XADD `ingestion:events` → Consumer Group 消费 → 句边界切分（512/50）→ DashScope 批量嵌入 → Qdrant upsert（同 doc_hash 幂等）。
- **真实 RAG 管线**：`POST /v1/retrieval/query` —— 嵌入 → 远程 Qdrant `knowledgeOfAI` 检索 → qwen-plus 中文合成。
- **工作流编排（端到端）**：web 画布编辑（增删节点/连线/条件边）→ 保存（PUT，改图自动升版本）→ 版本历史浏览 → `POST /v1/workflows/:id/run` 多轮执行（messages 历史重放 + MemorySaver checkpointer）。
- **摄入三来源**：chokidar / `POST /webhooks/:source` / 定时轮询 hash 比对。
- **端到端类型安全**：`@repo/types` zod schema → api 路由 → `AppType` → web `hc<AppType>`。

## 核心设计

- **Hono 是框架，集成为插件**：LangGraph.js / LlamaIndexTS / Qdrant / Langfuse(OTel) / drizzle+PG / ioredis 均为 `apps/api/src/plugins/<name>/` 下的插件，`PluginRegistry` 统一管理（topo 排序 → zod 配置校验 → 懒连接 init → 路由 → 优雅停机）。
- **懒连接 + 优雅降级**：未配置的插件 `{ disabled, reason }` 降级（`/readyz` 可见）；`STRICT_INTEGRATIONS=true` 启动报错。503 = 集成未配置，502 = 上游调用失败。
- 插件/路由/配置编写指南见 [apps/api/README.md](apps/api/README.md)；环境变量见各 app 的 `.env.example`（真实凭据在各 app `.env`，已 gitignore）。

## 部署（Docker）

三个服务均可从仓库根独立构建（多阶段：安装 → workspace 构建 → `pnpm deploy` 提取生产产物）：

```bash
docker build -f apps/api/Dockerfile       -t repo-api       .
docker build -f apps/ingestion/Dockerfile -t repo-ingestion .
docker build -f apps/web/Dockerfile       -t repo-web       .
```

运行时配置：

- **环境变量**：容器不内置凭据，经编排注入（docker run `-e` / k8s Secret）。api 需要 `QDRANT_*`、`OPENAI_*`（DashScope）、`DATABASE_URL`（自签证书加 `sslmode=no-verify`）、`REDIS_URL`；ingestion 需要 `INGEST_DIR`、`REDIS_URL`、`QDRANT_*`、`OPENAI_*`；web 用 `NEXT_PUBLIC_API_URL`（建议构建期注入，Next 会内联）。
- **健康检查**：`GET /healthz`（存活）与 `GET /readyz`（就绪：enabled 插件全健康 200，否则 503）直接对接 k8s liveness/readiness probe。
- **优雅停机**：api/ingestion 均监听 SIGTERM 逆序回收插件资源（redis/pool/OTel flush），k8s `terminationGracePeriodSeconds` 留 10s+ 即可。
- **非 Edge 部署**：api/ingestion 是长驻 Node 进程（@hono/node-server），不可部署到边缘运行时（Vercel Edge/CF Workers）；web 是标准 Next.js。

