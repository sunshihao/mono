前端：  Next.js 14 + React Flow + shadcn/ui
       │
       │  hono/client（端到端类型安全 RPC）
       ▼
后端：  Hono（Node.js，API 网关）
       │
       ├── LangGraph.js         编排引擎
       ├── LlamaIndexTS         检索 + 索引
       ├── @qdrant/js-client-rest
       ├── @langfuse/tracing + @langfuse/otel   可观测性（v5，OTel 架构）
       ├── drizzle-orm          PostgreSQL（元数据/工作流版本）
       └── ioredis              缓存 / PubSub / Streams（摄入队列）

独立服务： ingestion-service（长驻 Node 进程，非 Edge 部署）
       ├── chokidar             本地/挂载卷文件监听
       ├── Hono webhook 路由     SaaS 数据源推送（Confluence/Notion 等）
       ├── 定时轮询兜底           旧系统 Hash 比对
       └── 统一写入 ioredis Stream（XADD）→ Consumer Group 消费

共享：  @repo/types（pnpm workspace 共享类型：workflow 图结构、API 请求/响应、Agent State）
