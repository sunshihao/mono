# @repo/api —— Hono 框架 + 插件体系

## 目录层级

```
src/
├── index.ts              # 入口：首行 import telemetry/init（OTel 必须先于被插桩模块加载）
├── server.ts             # @hono/node-server 引导 + SIGINT/SIGTERM 优雅停机
├── app.ts                # createApp(plugins)：组合根（可测试，不监听端口）
├── types.ts              # AppEnv（Hono Env 增强）+ 静态 Services 映射
├── config/env.ts         # 全局 env（PORT/LOG_LEVEL/STRICT_INTEGRATIONS）zod 校验
├── telemetry/init.ts     # OTel SDK（有 LANGFUSE 密钥才启动，否则 no-op）
├── plugins/
│   ├── types.ts          # Plugin 契约（name/version/deps/configSchema/init/health/routes）
│   ├── registry.ts       # PluginRegistry：topo 排序 / 校验 / init / dispose / health
│   ├── index.ts          # 汇总 plugins 数组（新插件在此注册）
│   ├── redis/            # ioredis（缓存 / PubSub / Streams）
│   ├── db/               # drizzle + pg（schema 见 src/db/schema.ts）
│   ├── qdrant/           # @qdrant/js-client-rest
│   ├── observability/    # Langfuse v5 OTel（含插件路由演示 /v1/observability/status）
│   ├── langgraph/        # 编排占位（passthrough 编译图）
│   └── llamaindex/       # 检索/索引占位（Settings.llm + 稳定契约的 stub query）
├── middleware/           # request-id / logger / services 注入 / cors / error-handler
├── routes/               # health(healthz/readyz) / workflows(CRUD) / retrieval(query)
├── db/schema.ts          # drizzle 表：workflows + workflow_versions
└── lib/                  # logger（pino）/ errors（ConfigError）
```

## 插件机制

每个集成 = 一个插件，四个生命周期阶段：

```ts
// plugins/<name>/index.ts 的契约（见 plugins/types.ts）
export const xxxPlugin: Plugin<XxxService> = {
  name: "xxx",                    // 必须与 types.ts 的 Services key 对应（编译期校验）
  version: "0.1.0",
  deps?: ["redis"],               // 依赖的插件（注册表做 topo 排序）
  configSchema: z.object({ XXX_URL: z.string().url() }),
  init(ctx) { ... },              // 懒连接；未配置则不会进入 init
  health?(service) { ... },       // /readyz 每次调用
  routes?(getServices) { ... },   // 可选子路由（basePath 定前缀）
};
```

新增插件三步：① `plugins/<name>/index.ts` 实现契约；② 在 `src/types.ts` 的 `Services` 加一项；③ 在 `plugins/index.ts` 注册。配置缺失自动降级 `disabled`（reason 进 `/readyz`）；`STRICT_INTEGRATIONS=true` 则启动报错。

## 路由一览

| 路由 | 行为 |
|---|---|
| `GET /healthz` | 存活探测，恒 200 |
| `GET /readyz` | 就绪：enabled 插件全健康 → 200；有异常 → 503 + 逐插件状态 |
| `GET/POST /v1/workflows`、`GET/DELETE /v1/workflows/:id` | 工作流 CRUD（db 未配置 → 503） |
| `POST /v1/retrieval/query` | 检索查询（llamaindex 未配置 → 契约形状稳定的 stub） |
| `GET /v1/observability/status` | 插件路由演示 |

## 环境变量

复制 `.env.example` 为 `.env`（已 gitignore）。Node 22 的 `--env-file-if-exists` 在 `pnpm dev` 时自动加载。未配置的集成不阻塞启动。

## 开发

```bash
pnpm dev          # tsx + node --watch（自动加载 .env）
pnpm test         # vitest（app.request() 免起端口）
pnpm db:generate  # drizzle-kit 生成迁移（需 DATABASE_URL 可达）
```
