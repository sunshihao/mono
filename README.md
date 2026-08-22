# mono — AI 知识库 monorepo（样板框架）

技术蓝图见 [plan.md](plan.md)。当前进度：**五个阶段全部完成**（框架/检索编排/数据闭环/工作流端到端/可观测与生产化，全链路实测）。

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

### 各容器 .env 内容（docker 化后必须提供）

镜像不含任何凭据。两种注入方式二选一：**① `docker run --env-file <宿主机 .env>`**；**② 挂载到容器内 `/app/.env`**（api/ingestion 的启动命令已带 `--env-file-if-exists=.env` 自动加载）。凭据以根 `.env`（JSON 总账）为唯一事实源，按下方键名拆分到各服务：

**api（端口 3000，挂载卷建议：无，无状态）**

```dotenv
# ---- 服务 ----
PORT=3000
LOG_LEVEL=info
STRICT_INTEGRATIONS=false        # true = 未配置的集成启动报错

# ---- 远程资源（取自根 .env 总账）----
DATABASE_URL=postgresql://myappuser:****@<host>:5433/myappdb?sslmode=no-verify
REDIS_URL=redis://:****@<host>:6380/0
QDRANT_URL=http://<host>:6333
QDRANT_API_KEY=<token>

# ---- LLM / 嵌入（DashScope OpenAI 兼容）----
OPENAI_API_KEY=<sk-...>
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
RAG_CACHE_TTL=300                # 检索响应缓存秒数，0 禁用（需 REDIS_URL）

# ---- 可观测（可选；配齐才启动 OTel SDK 上报 Langfuse）----
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_HOST=https://cloud.langfuse.com
```

**ingestion（端口 3002，挂载卷建议：被监听目录 `-v /data/docs:/data/docs`）**

```dotenv
# ---- 服务 ----
PORT=3002
LOG_LEVEL=info
INGEST_DIR=/data/docs              # 容器内被监听目录（宿主目录经 -v 挂载）
POLL_INTERVAL_MS=60000

# ---- 远程资源 ----
REDIS_URL=redis://:****@<host>:6380/0
QDRANT_URL=http://<host>:6333
QDRANT_API_KEY=<token>

# ---- LLM / 嵌入 ----
OPENAI_API_KEY=<sk-...>
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
```

**web（端口 3001）**：无需运行时 `.env`——`NEXT_PUBLIC_API_URL` 是**构建期内联**的，须在 `docker build` 时注入：

```bash
docker build --build-arg NEXT_PUBLIC_API_URL=http://<api-host>:3000 \
  -f apps/web/Dockerfile -t repo-web .
```

（或改用 `-e NEXT_PUBLIC_API_URL=...` 在 `docker run` 时传入，效果相同。）

### 运行示例

```bash
# 方式一：宿主机 .env 文件注入（推荐，凭据不进镜像）
docker run -d --name repo-api --env-file ./deploy/api.env -p 3000:3000 repo-api

# 方式二：容器内挂载 .env（api/ingestion 启动命令会自动加载）
docker run -d --name repo-api -v ./deploy/api.env:/app/.env -p 3000:3000 repo-api

# ingestion 额外挂载被监听目录
docker run -d --name repo-ingestion --env-file ./deploy/ingestion.env \
  -v /data/docs:/data/docs -p 3002:3002 repo-ingestion
```

### 运维对接

- **健康检查**：`GET /healthz`（存活）与 `GET /readyz`（就绪：enabled 插件全健康 200，否则 503）直接对接 k8s liveness/readiness probe。
- **优雅停机**：api/ingestion 均监听 SIGTERM 逆序回收插件资源（redis/pool/OTel flush），k8s `terminationGracePeriodSeconds` 留 10s+ 即可。
- **非 Edge 部署**：api/ingestion 是长驻 Node 进程（@hono/node-server），不可部署到边缘运行时（Vercel Edge/CF Workers）；web 是标准 Next.js。

