# mono — AI 知识库 monorepo（样板框架）

技术蓝图见 [plan.md](plan.md)。当前进度：**里程碑 1 —— Hono 框架与插件体系**（已完成 apps/api 骨架与共享类型包；apps/web、apps/ingestion 为下一期）。

## 结构

```
mono/
├── apps/
│   └── api/          # @repo/api —— Hono API 网关（框架核心，集成一律为插件）
└── packages/
    └── types/        # @repo/types —— 共享 zod schema + 类型（workflow 图 / API DTO / AgentState / ingestion 信封）
```

## 常用命令

| 命令 | 说明 |
|---|---|
| `pnpm install` | 安装全部 workspace 依赖 |
| `pnpm dev` | 构建 types 后启动 api（Node 22 自动加载 apps/api/.env） |
| `pnpm build` | 构建全部包（tsc → dist） |
| `pnpm typecheck` | 全 workspace 类型检查 |
| `pnpm test` | 全 workspace 测试（vitest） |
| `pnpm lint` | eslint 全仓检查 |

## 核心设计

- **Hono 是框架，集成为插件**：LangGraph.js / LlamaIndexTS / Qdrant / Langfuse(OTel) / drizzle+PG / ioredis 均为 `apps/api/src/plugins/<name>/` 下的插件，由 `PluginRegistry` 统一管理生命周期（topo 排序 → zod 配置校验 → 懒连接 init → 路由挂载 → 优雅停机）。
- **懒连接 + 优雅降级**：未配置的插件以 `{ disabled, reason }` 降级，`/readyz` 可见；`STRICT_INTEGRATIONS=true` 时变为启动报错。
- **端到端类型安全**：`@repo/types` 的 zod schema 是唯一事实源（路由校验 + 前端 `hono/client` 复用）；`AppType` 由 `@repo/api` 导出。
- 插件/路由/配置的编写指南见 [apps/api/README.md](apps/api/README.md)。

## 环境变量

全局配置见根 `.env.example`；集成配置见 [apps/api/.env.example](apps/api/.env.example)（含远程 Qdrant 等说明）。
