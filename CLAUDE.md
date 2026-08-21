# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state (2026-08-21)

**里程碑 1 已完成**：pnpm workspace monorepo（无 git 仓库）+ Hono 框架骨架。技术蓝图见 `plan.md`，插件开发指南见 `apps/api/README.md`。

- `apps/api`（`@repo/api`）— Hono API 网关，**框架核心**。LangGraph.js / LlamaIndexTS / Qdrant / Langfuse(OTel) / drizzle+PG / ioredis 一律作为插件挂在 `src/plugins/<name>/`，由 `PluginRegistry` 管理生命周期（topo 排序 → zod 配置校验 → 懒连接 init → 路由 → dispose）。未配置的插件自动降级 disabled（`/readyz` 可见）；`STRICT_INTEGRATIONS=true` 则启动报错。
- `packages/types`（`@repo/types`）— 共享 zod schema/类型：workflow 图、API DTO、AgentState、ingestion 消息信封、RAG 常量（对齐 ../RAG：集合 `knowledgeOfAI`、向量 `text-embedding-v4` 1024 维）。zod schema 是唯一事实源，路由（zValidator）与前端（hono/client + `AppType` from `@repo/api`）复用。
- `apps/web`、`apps/ingestion` 尚未创建（下一期）。`packages/shared-types`/`rag-core`/`db` 计划已由 `@repo/types` 与 `apps/api/src/db` 取代。

## Commands

```bash
pnpm install      # 安装全部 workspace 依赖
pnpm dev          # 构建 types 后启动 api（Node 22 --env-file-if-exists 自动加载 apps/api/.env）
pnpm build        # tsc → dist（先 types 后 api）
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

## Context

The sibling project `../RAG` is a Python LlamaIndex-based RAG prototype (Qdrant collection `knowledgeOfAI`, DashScope embeddings `text-embedding-v4` 1024-dim, `qwen-plus` LLM, dedup key `doc_hash` sha256). This monorepo is its planned rewrite; before porting logic (ingestion、检索管线、迁移), check `../RAG` for the reference implementation and data formats — 字段映射见 `packages/types/src/rag.ts`。
