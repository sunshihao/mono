# 数据入口（Data Access）—— 为其他 LLM / Claude Code 供给知识库数据

本工作台的知识库（Qdrant 向量 + PG 元数据）以四类入口对外供给数据。
**所有凭据以根 `.env`（JSON 总账）为唯一事实源**，本文档中的 `<占位符>` 均指向其中对应字段。

```
其他 LLM / Agent / Claude Code
   │
   ├─ ① HTTP API（推荐程序接入）      http://<api-host>:3000
   ├─ ② MCP Server（Claude Code 原生） stdio：node apps/mcp/dist/index.js
   ├─ ③ Qdrant 直连（向量级）          http://<qdrant-host>:6333（api-key 鉴权）
   └─ ④ PostgreSQL 直连（元数据级）    postgresql://<user>:<pass>@<pg-host>:5433/myappdb
```

---

## ① HTTP API（程序接入，端到端类型安全）

Base URL：`http://<api-host>:3000`（Docker 部署时对应 repo-api 容器端口）。

| 端点 | 用途 |
|---|---|
| `POST /v1/retrieval/search` | **纯检索**：返回上下文块 + 来源 + 分数，不合成——适合作为你自己的 LLM 的上下文 |
| `POST /v1/retrieval/query` | 完整 RAG：返回合成答案 + 来源 |
| `GET /v1/workflows` | 工作流列表 |
| `POST /v1/workflows/:id/run` | 执行工作流（支持多轮 messages） |

**检索（上下文供给）**：

```bash
curl -X POST http://<api-host>:3000/v1/retrieval/search \
  -H "content-type: application/json" \
  -d '{"query":"星尘协议的核心概念","topK":5}'
```

响应（把 `results[].text` 拼进你自己的 prompt 即可）：

```json
{
  "query": "星尘协议的核心概念",
  "results": [
    {
      "text": "星尘粒子是知识的最小同步单元……",
      "file_path": "/data/docs/星尘协议.md",
      "file_name": "星尘协议.md",
      "doc_hash": "8b56ed33…",
      "score": 0.842
    }
  ],
  "provider": "llamaindex",
  "disabled": false
}
```

- 未配置时 `disabled: true` 且 `results: []`（契约稳定，调用方可安全降级）
- 上游故障返回 502；入参错误返回 400（zod issues）
- **类型安全**：TS 调用方可 `import type { SearchResponse } from "@repo/types"`；web 侧有 `hc<AppType>` 全链类型
- 检索响应带 Redis 缓存（`rag:search:*`，TTL 见 `RAG_CACHE_TTL`），高频调用成本低

## ② MCP Server（Claude Code / Claude Desktop 接入）

`apps/mcp` 是一个 stdio 模式的 MCP Server（薄协议层，内部转调 ① 的 HTTP API），暴露 4 个工具：

| 工具 | 功能 |
|---|---|
| `search_knowledge` | 纯检索上下文块（带来源与分数） |
| `rag_query` | 知识库问答（合成答案 + 引用） |
| `list_workflows` | 编排工作流列表 |
| `run_workflow` | 执行工作流（支持多轮） |

**Claude Code 配置**（先构建 `pnpm --filter @repo/mcp build`）：

```bash
# 注册（一次即可，长期有效）
claude mcp add rag-workbench -- node <mono路径>/apps/mcp/dist/index.js

# 或写入项目级配置 .mcp.json（随仓库共享给团队）
{
  "mcpServers": {
    "rag-workbench": {
      "command": "node",
      "args": ["<mono路径>/apps/mcp/dist/index.js"],
      "env": { "API_URL": "http://localhost:3000" }
    }
  }
}
```

注册后在 Claude Code 中直接问「用 search_knowledge 检索星尘协议」，它会调用 MCP 工具取回知识库上下文作答。`API_URL` 环境变量指向 ① 的网关（跨机部署时改为网关地址）。

## ③ Qdrant 直连（向量级入口，幂等只读）

凭据见根 `.env` 的 `qdrant` 节（`url` / `apiKey`）。适合需要**原始向量或细粒度过滤**的消费方。

```bash
# 集合信息（knowledgeOfAI：命名向量 text-embedding-v4，1024 维 Cosine）
curl -H "api-key: <QDRANT_API_KEY>" http://<qdrant-host>:6333/collections/knowledgeOfAI

# 原生向量检索（query 为 1024 维向量；骨架内无直接对外端口，程序内联用）
curl -X POST http://<qdrant-host>:6333/collections/knowledgeOfAI/points/query \
  -H "api-key: <QDRANT_API_KEY>" -H "content-type: application/json" \
  -d '{"query": [0.1, 0.2, "…1024 维…"], "using": "text-embedding-v4", "limit": 5, "with_payload": true}'

# 按文档过滤的全部块（payload 字段：text/file_path/file_name/doc_hash/start_char_idx…）
curl -X POST http://<qdrant-host>:6333/collections/knowledgeOfAI/points/scroll \
  -H "api-key: <QDRANT_API_KEY>" -H "content-type: application/json" \
  -d '{"filter": {"must": [{"key": "file_name", "match": {"value": "星尘协议.md"}}]}, "limit": 10, "with_payload": true}'
```

注意：
- **需要嵌入模型才能构造查询向量**——没有自己的嵌入服务时，请用 ① 的 `/v1/retrieval/search`（嵌入在网关内完成）
- 明文 HTTP 携带 token（客户端会警告），生产建议 HTTPS
- 向量是 1024 维 `text-embedding-v4`（DashScope），用其他嵌入模型检索会失效

## ④ PostgreSQL 直连（元数据级入口）

凭据见根 `.env` 的 `postgresql` 节（`url`，自签证书已带 `sslmode=no-verify`）。表结构：

```sql
-- 工作流定义与版本历史
SELECT id, name, version, created_at FROM workflows ORDER BY created_at DESC;
SELECT version, created_at, graph FROM workflow_versions WHERE workflow_id = '<uuid>' ORDER BY version DESC;
```

- `workflows.graph` / `workflow_versions.graph` 为 jsonb 的 WorkflowGraph（nodes/edges），schema 见 `@repo/types` 的 `WorkflowGraphSchema`
- 适合 BI/审计/元数据分析；**业务读写请走 ① 的 API**（版本管理、校验、编译执行都在网关层）

---

## 入口选择建议

| 场景 | 入口 |
|---|---|
| 自己的 LLM 应用需要上下文 | ① `POST /v1/retrieval/search`（拼进 prompt） |
| Claude Code / Claude Desktop | ② MCP（`claude mcp add` 一条命令） |
| 需要原始向量/自定义过滤/迁移数据 | ③ Qdrant 直连（需自备嵌入） |
| 元数据报表 / 审计 | ④ PG 直连（只读） |
