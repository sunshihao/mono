# mono — AI 知识库 monorepo（样板框架）

技术蓝图见 [plan.md](plan.md)。当前进度：**五个阶段全部完成**（框架/检索编排/数据闭环/工作流端到端/可观测与生产化，全链路实测）。

## 结构

```
mono/
├── apps/
│   ├── api/          # @repo/api —— Hono API 网关（框架核心，集成一律为插件）
│   ├── data/         # @repo/data —— 多仓库→多向量库增量同步（webhook→Stream→diff→嵌入→per-repo collection）
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
| `pnpm dev:data` | 启动 data 服务（webhook + worker + 对账一体化，3003） |
| `pnpm dev:web` | 构建 types/api 后启动 web(3001) |
| `pnpm build` | types → api → ingestion → data → web |
| `pnpm typecheck` / `pnpm test` / `pnpm lint` | 全仓类型检查 / 测试 / 检查 |

## 核心能力

- **数据写入闭环**：文件放入 `INGEST_DIR` → chokidar 事件 → XADD `ingestion:events` → Consumer Group 消费 → 句边界切分（512/50）→ DashScope 批量嵌入 → Qdrant upsert（同 doc_hash 幂等）。
- **多仓库 → 多向量库增量同步**：`apps/data` 把任意数量的 GitHub 仓库同步进 Qdrant——每仓库一个独立 collection，push 时只同步本次提交的 A/M/D/R 文件变化（见下文专节）。
- **真实 RAG 管线**：`POST /v1/retrieval/query` —— 嵌入 → 远程 Qdrant **多集合检索**（`knowledgeOfAI` 命名向量 + apps/data 同步的 per-repo 未命名向量集合，`RAG_SEARCH_COLLECTIONS` 声明清单，逐集合查询按 score 合并取 topK）→ qwen-plus 中文合成。
- **工作流编排（端到端）**：web 画布编辑（增删节点/连线/条件边）→ 保存（PUT，改图自动升版本）→ 版本历史浏览 → `POST /v1/workflows/:id/run` 多轮执行（messages 历史重放 + MemorySaver checkpointer）。
- **摄入三来源**：chokidar / `POST /webhooks/:source` / 定时轮询 hash 比对。
- **端到端类型安全**：`@repo/types` zod schema → api 路由 → `AppType` → web `hc<AppType>`。
- **外部数据供给**：知识库作为数据源对 **其他 LLM / Claude Code** 开放——纯检索端点（`/v1/retrieval/search`）、MCP Server（`apps/mcp`，Claude Code 一条命令接入）、Qdrant/PG 直连，详见 [DATA_ACCESS.md](DATA_ACCESS.md)。

## 架构说明（对 plan.md 的实现方式）

### 总体架构

```
                      ┌─────────────────────────────────────────────┐
                      │  远程基础设施（凭据集中于根 .env JSON 总账）      │
                      │  PostgreSQL :5433   Redis :6380   Qdrant :6333 │
                      │  DashScope（千问 qwen-plus + text-embedding-v4）│
                      └──────┬──────────────┬──────────────┬──────────┘
                             │              │              │
   ┌─────────────┐    ┌──────▼──────┐  ┌────▼───────┐  ┌───▼───────────┐
   │ apps/web    │    │  apps/api   │  │ ingestion  │  │  Langfuse(可选) │
   │ Next 14     │hc  │ Hono 网关    │  │ chokidar   │  │  OTel SDK     │
   │ React Flow  ├───▶│ 插件体系     │  │ webhook    │  │  (SpanProcessor│
   │ 画布/检索面板 │    │ ┌─────────┐ │  │ 轮询兜底    │  │   + 业务埋点)  │
   └─────────────┘    │ │langgraph│ │  │   │ XADD   │  └───────────────┘
        AppType       │ │llamaindex│ │  │   ▼       │
   （端到端类型安全）   │ │qdrant   │ │  │ Redis Stream
                      │ │drizzle  │ │  │   │ XREADGROUP（Consumer Group）
                      │ │ioredis  │ │  │   ▼
                      │ │observab.│ │  │ 切分(512/50)→嵌入→Qdrant upsert
                      │ └─────────┘ │  └───────────────┘
                      └─────────────┘
                 packages/types —— zod schema 唯一事实源（全链路复用）
```

### 技术选型与理由

| plan.md 蓝图 | 实际实现 | 为什么这样用 |
|---|---|---|
| Next.js 14 | **next@14.2.35 精确钉版** | 蓝图指定；React 18 严格配套（15/16 升 React 19 会破坏 @xyflow/react 兼容面） |
| React Flow | **@xyflow/react v12** | 官方新包名（reactflow v11 已弃）；画布编辑与只读预览共用一套受控组件 |
| shadcn/ui | 手工组件（button/card/input/badge）+ CSS 变量 token | 不依赖 CLI 的确定性；暗色可读性问题通过「React Flow 样式全部走 CSS 变量」根治 |
| hono/client 类型安全 | **AppType = 链式累积 Schema 的 `typeof app`**，web 端 `hc<AppType>` | Hono 的 route() 返回 Schema 是 union（keyof 塌缩），mount 函数 cast 成交叉 + 泛型参数保留累积——详见 CLAUDE.md 的 AppType gotchas |
| Hono API 网关 | **自研 PluginRegistry 插件体系**（非中间件堆叠） | 集成需要生命周期：topo 依赖排序、zod 配置校验、懒连接 init、优雅停机 dispose、就绪状态（/readyz）——中间件模型表达不了这些 |
| LangGraph.js 编排 | **@langchain/langgraph v1.4**：可序列化 `WorkflowGraph` → 编译成执行图 | 图存 PG（jsonb），运行时编译执行；router 出边 `condition`=路由键的约定使图与引擎解耦 |
| LlamaIndexTS 检索+索引 | **检索**用 @llamaindex/openai（嵌入/LLM）+ qdrant client 直连；**索引**自实现切分器（TS 版无 SentenceSplitter） | 弃用 @llamaindex/qdrant（0.1.33 与 core 0.6.22 版本错位）；直连 `client.query({using: 命名向量})` 精确对齐 ../RAG 的集合结构 |
| Langfuse v5 OTel | **LangfuseSpanProcessor**（非 Exporter）+ 业务埋点（rag.pipeline/embed/search/synthesize、llm.chat、langgraph.node） | v5 API 已改；埋点用全局 no-op tracer（SDK 未启动也安全），配密钥即上报 |
| drizzle + PG | workflows + workflow_versions 两表，图存 jsonb；PUT 改图自动 version+1 写历史 | 版本历史是编排可追溯的基础；懒连接（无 PG 时降级 503） |
| ioredis | 三用途：Stream（XADD/XREADGROUP 队列）、PubSub（摄入通知）、缓存（检索响应 setex） | 一个客户端覆盖蓝图三种需求；未配置时各自降级 |
| chokidar | v5（ESM-only、无 glob）+ 启动基线扫描 + sha256 内容去重 | 新版本 API；`ignoreInitial` 之外的存量文件用基线哈希，避免启动风暴 |
| @repo/types | zod v3 唯一事实源（全仓钉 v3） | zod v4 与 v3 schema 混用运行时崩溃（踩过）；schema → zValidator → AppType → hc 一条链 |

### 实现状态（五个阶段全部完成）

1. **框架骨架**：插件体系（6 集成懒连接 + 优雅降级）、@repo/types、错误语义（503 未配置 / 502 上游失败）
2. **检索与编排**：真实 RAG 管线（嵌入→Qdrant→qwen-plus）、WorkflowGraph 编译执行、ingestion/web 骨架
3. **数据写入闭环**：文件→Stream→Consumer Group→切分→嵌入→upsert（幂等），检索命中新文档实测
4. **工作流端到端**：画布编辑保存、版本历史、多轮 /run（MemorySaver checkpointer + messages 重放）
5. **可观测与生产化**：OTel 业务埋点、检索缓存（实测 80 倍加速）、PubSub 通知、Notion/Confluence 适配器、Docker 部署化

### 待改进（已知短板）

| 项 | 现状 | 改进方向 |
|---|---|---|
| Langfuse 上报 | 埋点已就绪但**缺密钥未实测**；OTel SDK 2.x + api 1.9 组合下 span 父子链存疑 | 提供 LANGFUSE_* 后实测 trace 树完整性，必要时对齐 OTel 版本 |
| SaaS 正文拉取 | Notion/Confluence 适配器只做「内容指针规范化」，不拉正文 | 各源连接器（API token）拉取 + 再嵌入 |
| 索引增量 | 同 doc_hash 全量重写（先删后写）；缓存 TTL 有陈旧窗口 | 块级增量 diff；api 订阅 `ingestion:notifications` 主动失效缓存（频道已就绪） |
| checkpointer | MemorySaver 进程内存，重启丢状态 | PG checkpointer（drizzle 已就绪） |
| 画布编辑 | 无撤销/重做、无节点 config 表单；router 条件为字符串约定 | 命令栈、节点属性面板、条件表达式 DSL |
| 认证/授权 | 骨架未做 | 网关层 auth 中间件（插件机制可挂载） |
| 编排与部署 | 无 docker-compose 服务编排；无 CI/e2e 测试 | compose 一键起 + 集成测试管线 |

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

