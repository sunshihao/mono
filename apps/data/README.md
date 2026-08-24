# @repo/data — 多 Git 仓库 → 多向量库 增量同步系统

宿主目录管理任意数量的 GitHub 仓库（`repos/*`，git submodule 或独立 clone），每个仓库对应一个独立的 Qdrant collection。仓库发生 push 时，仅把**本次提交的增量变化**（新增/修改/删除/重命名文件）同步进对应向量库。

设计文档（14 节蓝图）见仓库根目录的 `apps/data` 设计说明；本 README 是该设计的落地实现。

## 核心原则

- **配置驱动**：仓库 ↔ 向量库映射、glob 过滤、切块策略全部集中在 `sync.config.yaml`，新增仓库零代码改动
- **diff 驱动增量**：全量（首次接入）、增量（日常 push）、失败重跑统一走 `git diff <from> <to>`；首次接入用 git 空树 sha（`4b825dc...`）做 from，一套逻辑覆盖
- **状态外置 + 幂等写入**：同步进度存 `.sync-state/<repo>.state.json`；向量点 ID = `sha256(repo:file_path:chunk_index)`（转 UUID 格式），重复处理永远覆盖写同一批点，任意环节重放不产生脏数据
- **事务化推进**：向量库全部写入成功后才更新 state——失败永远停留在旧 sha，整段可重跑
- **仓库级隔离 + 水平扩展**：每仓库一条 Redis Stream + 消费租约（SET NX），同一仓库严格 FIFO，不同仓库完全并行，worker 可水平扩容

## 架构与数据流

```
GitHub push ─▶ [Webhook Receiver :3003] ─▶ Redis Stream data-sync:<repo> ─▶ [Sync Worker]
     ▲                                        （每仓库一条流，严格 FIFO）          │
     │                                                                              ▼
[Reconcile 对账] ◀── 定时 ls-remote 比对 state，落后补投递               git fetch + diff(A/M/D/R)
                                                                                 │
     Qdrant collection ◀── upsert/差集删除 ◀── 切块 → 嵌入 ◀── 文件级变更分类 ◀─┘
     .sync-state/<repo>.state.json ◀── 全部成功后写 last_synced_sha
```

| 组件 | 位置 | 职责 |
|---|---|---|
| Webhook Receiver | `src/webhook.ts` | 校验 `X-Hub-Signature-256`（每仓库独立 secret）→ 分支过滤 → 幂等键去重 → XADD |
| Event Queue | `src/queue.ts` | 每仓库一条 Stream + 全局延迟队列（ZSET，指数退避重试）+ 仓库 DLQ 流 |
| Sync Worker | `src/worker.ts` | 租约独占消费 → delivery 去重 → sync → ack；失败延迟重投；超限进 DLQ |
| Sync 编排 | `src/sync.ts` | fetch → 定目标 sha → state 定 from → 收敛检查 → diff → ingest → 事务化写 state |
| Ingest 管线 | `src/ingest.ts` | A/M/D/R 分类 → 切块 → 批量嵌入 → upsert/差集删除（幂等） |
| Reconcile | `src/reconcile.ts` | 定时对账兜底：远端头 vs state，落后补投递（防 webhook 丢失） |

## 目录结构

```
apps/data/
├── sync.config.yaml          # 仓库 <-> 向量库 映射总配置（唯一真源）
├── repos/                    # 各子仓库（submodule/clone，gitignore）
├── .sync-state/              # 每仓库同步状态（gitignore）
├── scripts/sync.sh           # MVP 手动触发入口
├── src/                      # 实现（模块划分见上表）
└── test/                     # vitest 全离线单测（76 例）
```

## 配置（sync.config.yaml）

```yaml
version: 1
vector_store:
  provider: qdrant            # 目前仅 qdrant
  url: env:QDRANT_URL         # 任意字符串值可写 env:VAR 注入
  api_key: env:QDRANT_API_KEY
embedding:
  provider: dashscope         # dashscope | openai（OpenAI 兼容端点）
  model: text-embedding-v4
  dimensions: 1024
  batch_size: 16              # 嵌入批大小（限流时自动指数退避重试）
  api_key: env:OPENAI_API_KEY
  base_url: https://dashscope.aliyuncs.com/compatible-mode/v1
repositories:
  - name: chinese-buy-us-stock-guide   # 内部唯一名（state 文件名/流名）
    github: zgwl/chinese-buy-us-stock-guide  # webhook 按 full_name 匹配
    local_path: repos/chinese-buy-us-stock-guide
    branch: main
    collection: chinese-buy-us-stock-guide-main   # 显式声明目标集合
    include: ["**/*.md"]      # 只索引命中的文件
    exclude: ["**/imgs/**"]   # 排除规则
    chunking:
      strategy: auto          # auto | markdown_aware | code_aware | fixed_size
      chunk_size: 800         # 每块字符数（≈token：中文 1 字符≈1 token）
      overlap: 100
    webhook_secret_ref: env:GH_WEBHOOK_SECRET_STOCK_GUIDE
```

要点：

- `env:VAR` 引用在加载时解析，**缺失即报错**（fail-fast）；唯一例外是 `webhook_secret_ref`——缺失时仅该仓库的 webhook 被拒（503），不影响 CLI/对账等路径
- `include/exclude` 为 glob（picomatch），相对仓库根；二进制文件（含 NUL 字节）与超过 1MB 的文件自动跳过
- `chunking.strategy: auto` 按扩展名选择：md/txt → markdown_aware，代码扩展名 → code_aware，其余 fixed_size

## 新仓库接入（三步）

```bash
# 1. 拉取仓库（推荐 submodule，commit 指针可追踪；普通 clone 亦可）
git submodule add https://github.com/org/new-repo.git apps/data/repos/new-repo

# 2. sync.config.yaml 登记一条映射（name/github/local_path/branch/collection/include/chunking）

# 3. 全量初始化（空树 diff → 切块 → 嵌入 → upsert → 写 state）
cd apps/data && pnpm cli backfill new-repo        # 先 --dry-run 预览
```

## GitHub Webhook 配置

对每个登记仓库（仅订阅 `push` 事件）：

- Payload URL：`https://<your-domain>/webhook/github`
- Content type：`application/json`
- Secret：`openssl rand -hex 20` 生成，写入 `.env` 的 `GH_WEBHOOK_SECRET_*`（与配置中的 `webhook_secret_ref` 对应）

接收端行为（`src/webhook.ts`）：非 push 事件（含 ping）→ 200 忽略；未知仓库 → 404；签名错误 → 400；分支不匹配 → 200 忽略；分支删除（after 全零）→ 200 忽略；同一 after 重复投递（幂等键 SET NX）→ 200 duplicate；secret 未配置 / Redis 不可用 → 503（fail-safe）。

## 命令

```bash
pnpm --filter @repo/data cli <command>          # 或 ./scripts/sync.sh <repo> [flags]

sync <repo> [--target <sha>] [--backfill] [--dry-run]   # 单仓库同步（MVP 入口）
backfill <repo> [--dry-run]                             # 全量重建（无视 state）
cleanup <repo> [--delete-collection]                    # 下线清理：删点 + 删 state（留审计日志）
status                                                  # 各仓库 state / 远端头 / 漂移一览
config-check                                            # 校验配置（含 env 注入结果）
reconcile [--once]                                      # 对账兜底（默认按 RECONCILE_INTERVAL_MS 循环）
worker                                                  # 仅消费 worker
webhook                                                 # 仅 webhook receiver
serve                                                   # 一体化：webhook + worker + reconcile
```

`--dry-run`：走完整 git→diff→切块链路并给出规划数量（A/M/D/R、点数），不嵌入、不写库、不推进 state。

## 运行

```bash
pnpm --filter @repo/data dev        # 一体化 serve（3003）
# 或单组件：pnpm --filter @repo/data cli worker / webhook / reconcile
```

环境变量（`.env`，见 `.env.example`）：

| 变量 | 说明 | 默认 |
|---|---|---|
| `QDRANT_URL` / `QDRANT_API_KEY` | 向量库（config 经 env:VAR 引用） | 必填 |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` | 嵌入（DashScope 兼容端点） | 必填 |
| `REDIS_URL` | 队列/租约/去重（缺失时 webhook 503，worker/对账停用） | — |
| `DATA_CONFIG_PATH` | 配置文件路径 | `sync.config.yaml` |
| `SYNC_STATE_DIR` | 状态目录 | `.sync-state` |
| `PORT` / `LOG_LEVEL` | 服务端口 / 日志级别 | `3003` / `info` |
| `WORKER_POLL_MS` / `WORKER_LEASE_MS` / `WORKER_MAX_RETRIES` | worker 轮询 / 租约 TTL（长 backfill 需大于单消息时长）/ 最大重试 | `1000` / `600000` / `5` |
| `RECONCILE_INTERVAL_MS` | 对账间隔 | `300000` |

## 同步语义与失败恢复

- **收敛检查**：worker 处理事件时，若目标 sha 已被 state 覆盖（重放/乱序旧事件，`git merge-base --is-ancestor`）→ stale 跳过；last_synced 非目标祖先（force-push）→ 警告后按树 diff 尽力同步
- **M 文件**：`content_hash` 未变 → 跳过免重嵌；变化 → upsert 新块后按「旧 ID − 新 ID」差集删除（防文件变短残留僵尸向量）
- **R 文件**：内容未变 → 向量搬运到新 path（免重嵌）；变化 → 删旧 + 增新；移入/移出 include 范围按 A/D 处理
- **重试**：同步失败 → 原消息 ack、副本入全局延迟队列（attempt+1，指数退避 2s→64s 封顶），不打乱本仓库 FIFO 也不阻塞后续事件；超过 `WORKER_MAX_RETRIES` → 仓库 DLQ 流 `data-sync:dlq:<repo>`（人工介入）
- **崩溃恢复**：worker 崩溃 → 租约到期自动释放；未 ack 的 pending 消息经 XAUTOCLAIM（min-idle 30s）被其他 worker 接管；delivery_id 经 processed 集合（7 天 TTL）去重，ack 丢失的重放不会重复同步
- **对账兜底**：即使 webhook 全部丢失，reconcile 每 5 分钟比对远端头与 state，落后即补投递（同一远端头 5 分钟只投一次）

## 可观测性

- 每次同步输出结构化日志：`repo/mode/from/to/stats{durationMs}`，含 A/M/D/R 计数与 upsert/delete 点数（字段见 `src/sync.ts`）
- 漂移告警信号：`pnpm cli status` 输出每仓库 `syncedSha` 与 `remoteHead` 的 `drift` 标记；reconcile 发现漂移时打 `drift detected` 日志
- worker 失败/重试/DLQ 均有结构化日志（`attempt/delayMs/err`）
- 后续可在此字段基础上接 Grafana/Langfuse 看板（设计 §12）

## 测试

```bash
pnpm --filter @repo/data test    # 76 例全离线：git fixture 仓库（file:// 远端）、fake store/embed/redis
```

覆盖：配置解析与 env 注入、三种切块策略、A/M/D/R diff 解析与空树 backfill、M 差集删除、R 向量搬运、content_hash 跳过、sync 事务化（失败不推进 state）、stale 收敛、webhook 签名/分支/去重、worker 消息决策（去重/DLQ/退避重投）、租约。

## Roadmap 落地状态

- ✅ MVP：CLI 单仓库同步 + 幂等 ID 设计（`sync`/`backfill`，`--dry-run`）
- ✅ Webhook 接入：receiver + Redis Stream 队列（签名校验/分支过滤/幂等去重）
- ✅ 对账任务：定时轮询兜底（防 webhook 丢失）
- ✅ 多仓库并发：每仓库独立流 + 消费租约，worker 可水平扩容
- ⏳ 运维完善：监控看板、DLQ 人工处理台、一键 backfill 工具化（`backfill` 命令已有，可视化后续）
