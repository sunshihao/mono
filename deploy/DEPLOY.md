# 服务器部署手册

把 mono（api / web / ingestion / data 四服务 + Caddy 反代）部署到一台 Linux 服务器。

> 本手册的命令与"坑"全部来自**实际跑通验证**（Docker Desktop 29.8.2 / Compose 5.5.1，2026-10-09）。
> 未实测的环节已用 ⚠️ 标注。

---

## 0. 先读这一页

### 服务与端口

| 服务 | 容器端口 | 宿主绑定（默认） | 对外暴露 | 有状态 | 副本数 |
|---|---|---|---|---|---|
| `api` | 3000 | `127.0.0.1:3000` | ❌ 只经 Caddy | 无 | **1**（见下） |
| `web` | 3001 | `127.0.0.1:3001` | ❌ 只经 Caddy | 无 | 1 |
| `ingestion` | 3002 | `127.0.0.1:3002` | ❌（可选放开 `/webhooks/*`） | 被监听目录 | 1（chokidar 单实例） |
| `data` | 3003 | `127.0.0.1:3003` | GitHub webhook 经 Caddy | `repos/`、`.sync-state/` | 1 |
| `caddy` | 80 / 443 | `0.0.0.0` | ✅ **唯一出口** | 证书 | 1 |

- **api 的业务路由目前没有任何鉴权**（只有 `/v1/auth/login` 用于签发 web 会话）。所以"端口只绑 127.0.0.1 + 只经 Caddy 出网"是**必需项，不是加固建议**。
- **副本数必须是 1**：api 的 langgraph checkpointer 是进程内存（MemorySaver，重启丢对话状态）；data 的 `repos/`+`.sync-state/` 是本地卷。
- api / ingestion / data 是长驻 Node 进程，**不能部署到边缘运行时**（Vercel Edge / CF Workers）。

### 服务器要求

| 项 | 要求 |
|---|---|
| OS | Linux x86_64（amd64） |
| Docker | ≥ 24，**Compose ≥ v2.24**（`env_file.required` 字段需要；实测 v5.5.1 可用） |
| 内存 | 构建期 ≥ 4GB（Next 构建最重）；运行期 ≥ 2GB |
| 磁盘 | 镜像 ~1.5GB + 构建缓存数 GB + data 的子仓库检出 |
| 网络 | 能拉 Docker Hub 基础镜像、能访问 npm registry、能访问 Qdrant/Redis/PG/DashScope |
| 域名 | 生产建议准备一个 A 记录指向本机的域名（Caddy 自动申请 Let's Encrypt） |

> 国内服务器：Docker Hub 与 npm 都可能很慢，见 [步骤 0](#步骤-0服务器准备) 的镜像加速与 npm 源。

### 基础设施放哪

两种都支持，二选一：

- **A. 复用已有远程设施**（PG / Redis / Qdrant / DashScope 已在别处跑，如 `115.190.209.1`）：把地址填进 `deploy/*.env` 即可。
- **B. 全部容器化**：`--profile local-infra` 起容器版 PG16 / Redis7 / Qdrant，此时各 env 里的主机名要改成 `postgres` / `redis` / `qdrant`（compose 服务名）。

---

## 1. 部署（服务器上构建，推荐）

### 步骤 0：服务器准备

```bash
ssh root@<server-ip>

# Docker（已装则跳过）
curl -fsSL https://get.docker.com | sh

# Docker Hub 加速 —— 腾讯云 CVM 用内网镜像；其他环境换成可用的 mirror
mkdir -p /etc/docker
cat >/etc/docker/daemon.json <<'EOF'
{ "registry-mirrors": ["https://mirror.ccs.tencentyun.com"] }
EOF
systemctl restart docker && docker info | grep -A3 "Registry Mirrors"

mkdir -p /opt/mono
```

> ⚠️ 以下为通用运维步骤，未在本项目的验证环境实测：docker 安装、镜像加速、firewall。

**防火墙**：只放 22 / 80 / 443。PG(5433) / Redis(6380) / Qdrant(6333) 若与本机同机，**不要暴露公网**（Qdrant 是明文 HTTP + token，PG 是自签证书，都只有单因子凭据）。

### 步骤 1：上传源码

在**构建机**（有源码的机器）上执行：

```bash
cd <repo>
rsync -avz --delete \
  --exclude 'node_modules' --exclude '**/node_modules' \
  --exclude '**/dist' --exclude '**/.next' \
  --exclude '.git' --exclude '.DS_Store' --exclude '*.log' \
  --exclude '*.tsbuildinfo' \
  --exclude 'apps/data/repos' --exclude 'apps/data/.sync-state' \
  --exclude '.env' --exclude 'deploy/*.env' --exclude '.npmrc' \
  ./ root@<server-ip>:/opt/mono/
```

- 排除 `deploy/*.env` 有个**关键副作用（是好事）**：rsync 默认不删被排除的文件，所以**服务器上的凭据文件在后续重复同步时不会被 `--delete` 清掉**。
- macOS 15+ 的 `/usr/bin/rsync` 是 openrsync，参数异常时改用 tar：
  `tar czf - --exclude='**/node_modules' --exclude='**/.next' --exclude='.git' . | ssh root@<ip> 'mkdir -p /opt/mono && tar xzf - -C /opt/mono'`
- 服务器能访问源码仓库时，也可以直接 `git clone <repo> /opt/mono`（后续更新用 `git pull`，但注意别覆盖 `deploy/*.env`）。

### 步骤 2：写凭据文件

```bash
cd /opt/mono
cp deploy/api.env.example       deploy/api.env
cp deploy/ingestion.env.example deploy/ingestion.env
cp deploy/data.env.example      deploy/data.env
cp deploy/web.env.example       deploy/web.env

# 生成两个密钥
openssl rand -base64 32   # → deploy/web.env 的 AUTH_SECRET（<32 字符会导致登录全部失败）
openssl rand -hex 20      # → deploy/data.env 的 GH_WEBHOOK_SECRET_STOCK_GUIDE（并与 GitHub 端一致）
```

> ### ⚠️ 填写规则（实测踩过的坑）
> **可选变量必须整行注释，不要写成 `KEY=` 留空。**
> compose 的 `env_file` 会把空值注入成**空字符串**；对 `z.string().url().optional()` 而言空串是
> "存在但非法"而不是"未配置"，于是 **ingestion / data 直接 `Exited(1)` 崩溃**（api 因插件注册表
> 容错，只降级 `disabled`）。各 `.env.example` 已按此规则写成注释形式，取消注释再填值即可。

**必填项速查**：

| 文件 | 必填 | 说明 |
|---|---|---|
| `deploy/api.env` | 按需 | `STRICT_INTEGRATIONS=true`（生产建议）；`DATABASE_URL` / `REDIS_URL` / `QDRANT_URL`+`QDRANT_API_KEY` / `OPENAI_API_KEY` 配齐才有对应能力 |
| `deploy/ingestion.env` | 无 | 三个都配齐才启动 consumer；`INGEST_DIR` 由 compose 固定为 `/data/docs` |
| `deploy/data.env` | **`QDRANT_URL`、`QDRANT_API_KEY`、`OPENAI_API_KEY`、`GH_WEBHOOK_SECRET_STOCK_GUIDE`** | data 的凭据是设计上的硬需求，缺失即 fail-fast 退出 |
| `deploy/web.env` | **`AUTH_SECRET`** | 会话签名密钥 |

`deploy/compose.env` 是**公开插值变量**（端口/域名/URL），无凭据，已入库，按需改。

### 步骤 3：检出 data 的子仓库（容器内不做 clone）

```bash
cd /opt/mono
git clone https://github.com/<org>/<repo>.git apps/data/repos/<name>
```

- 目录名必须与 `apps/data/sync.config.yaml` 里该仓库的 `local_path: repos/<name>` 对上。
- **私库**：把只读 token 放进 remote URL（`https://<token>@github.com/...`）。token 存在 `.git/config` 里，而整个目录被 bind mount 进容器，容器内的 `git fetch` 自动拿到同一份凭据。

### 步骤 4：构建并启动核心四服务

```bash
cd /opt/mono

# 国内服务器建议给容器内的 pnpm 也走国内源（仅服务器，不进 git；rsync 的 exclude 会保住它）
printf 'registry=https://registry.npmmirror.com\n' > /opt/mono/.npmrc

# 先校验编排文件（只做语法与插值校验，不校验凭据值）
pnpm docker:config -q      # 无 pnpm 时：docker compose --env-file deploy/compose.env config -q

pnpm docker:build          # 首次构建 5~15 分钟（Next 构建最重）
# 也可直接 pnpm docker:up 一步完成构建+启动
pnpm docker:up             # 启动（-d）
pnpm docker:ps             # 四个都应为 healthy
```

> **所有 compose 命令都必须带 `--env-file deploy/compose.env`**（`pnpm docker:*` 已封装）。
> 原因：compose 默认读项目根目录的 `.env` 做插值，而本仓根 `.env` 是 **JSON 凭据总账**，会直接报
> `failed to read ./.env: line 1: unexpected character "{"` 而无法启动。

### 步骤 5：反代 + HTTPS，并切到同源模式

```bash
cd /opt/mono
# 编辑 deploy/compose.env：
#   SITE_ADDRESS=<你的域名>
#   NEXT_PUBLIC_API_URL=https://<域名>/api
```

**顺序很重要**：`NEXT_PUBLIC_API_URL` 是 Next 的**构建期内联**值，必须先重建 web，再起 Caddy。

```bash
pnpm docker:up                                        # 会用新 URL 重建 web
docker compose --env-file deploy/compose.env --profile proxy up -d

curl -sI https://<域名>/login | head -1               # 期望 HTTP/2 200
curl -s  https://<域名>/api/healthz                   # 期望 {"status":"ok"}
```

**Caddy 之前想先看页面**：端口只绑了 127.0.0.1，用 SSH 隧道：

```bash
ssh -L 3000:127.0.0.1:3000 -L 3001:127.0.0.1:3001 root@<server-ip>
# 浏览器开 http://localhost:3001
```

### 步骤 6：配置 GitHub webhook

仓库 Settings → Webhooks → Add webhook：

| 字段 | 值 |
|---|---|
| Payload URL | `https://<域名>/webhook/github` |
| Content type | `application/json` |
| Secret | 与 `deploy/data.env` 的 `GH_WEBHOOK_SECRET_STOCK_GUIDE` **完全一致** |
| Events | Just the push event |

> 路径是**单数** `webhook`（data 的入口）；ingestion 的 SaaS 推送口是复数 `/webhooks/*`，默认未对外放开。

### 步骤 7：验证清单

```bash
cd /opt/mono

# 1) 插件就绪状态：disabled = 未配置（预期），error = 异常
curl -s localhost:3000/readyz | python3 -m json.tool

# 2) 登录链路（用错密码也应返回 401 而不是 503/404）
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<域名>/api/auth/login \
  -H 'content-type: application/json' -d '{"username":"<你库里的账号>","password":"wrong"}'
#   401 = 全链路通（Caddy→web→api→PG）｜503 auth_unavailable = web 服务端连不上 api（看 API_URL_INTERNAL）
#   404 = Caddy 把 /api/auth/* 错转给了后端（看 Caddyfile 的 handle 顺序）

# 3) 真实检索（嵌入 → Qdrant → qwen-plus 合成）
curl -s -X POST https://<域名>/api/v1/retrieval/query -H 'content-type: application/json' \
  -d '{"query":"美股开户流程","topK":3}' | head -c 300

# 4) data 同步状态
docker compose --env-file deploy/compose.env exec data node dist/cli.js status
docker compose --env-file deploy/compose.env exec data node dist/cli.js config-check

# 5) 浏览器登录后走一遍：画布 → 检索面板
```

### 步骤 8：首次数据灌入

**webhook 只同步"此后"的 push**，全新部署（`.sync-state/` 为空）需要一次全量：

```bash
docker compose --env-file deploy/compose.env exec data node dist/cli.js backfill <repo-name> --dry-run
docker compose --env-file deploy/compose.env exec data node dist/cli.js backfill <repo-name>
```

（其实 reconcile 兜底也会在 `RECONCILE_INTERVAL_MS` 内自动补上——它拿"空树 vs 远端头"做全量 diff；但显式 backfill 更可控、可观测。）

---

## 2. 其它构建方式

### 方式对比

| 方式 | 适用 | 代价 |
|---|---|---|
| **A. 服务器上构建**（上面用的） | 默认推荐 | 服务器需能拉基础镜像与 npm 包；占用构建期资源 |
| B. 别处构建 + 离线 tar | 服务器不联网 / 想统一构建 | 要搬运 ~1.5GB 镜像；**跨架构必须显式指定平台** |
| C. 构建 + 推 registry | 多台服务器 / CI 发布 | 需要 registry（国内建议 TCR/ACR） |

### B. 离线 tar 搬运

```bash
# 构建机（若在 arm64 Mac 上，必须显式指定平台，否则服务器上 exec format error）
docker buildx build --platform linux/amd64 -f apps/api/Dockerfile       -t repo-api       --load .
docker buildx build --platform linux/amd64 -f apps/web/Dockerfile       -t repo-web       --load .
docker buildx build --platform linux/amd64 -f apps/ingestion/Dockerfile -t repo-ingestion --load .
docker buildx build --platform linux/amd64 -f apps/data/Dockerfile      -t repo-data      --load .

docker save repo-api repo-web repo-ingestion repo-data | gzip > mono-images.tar.gz
scp mono-images.tar.gz root@<ip>:/opt/
ssh root@<ip> 'gunzip -c /opt/mono-images.tar.gz | docker load'
```

源码仍需同步到服务器（compose 文件与配置都在里面），**只有构建发生在别处**。
⚠️ arm64 Mac 上 `--platform linux/amd64` 是 qemu 模拟构建，Next 那步可能 20 分钟以上、偶发 OOM。

### C. registry

```bash
docker buildx build --platform linux/amd64 -f apps/api/Dockerfile -t <registry>/repo-api:v1 --push .
# 其余三个同理

# 服务器：pull 后打回本地短名，compose 无需改动
docker pull <registry>/repo-api:v1 && docker tag <registry>/repo-api:v1 repo-api
```

---

## 3. 日常运维

```bash
cd /opt/mono
pnpm docker:ps                       # 状态
pnpm docker:logs                     # 跟踪日志（--tail=100）
docker compose --env-file deploy/compose.env logs -f data      # 单服务

pnpm docker:down                     # 停（保留卷与数据）
docker compose --env-file deploy/compose.env restart api       # 重启单服务
```

### 更新版本

```bash
# 回滚锚点：重建前给当前镜像打标签
for i in api web ingestion data; do docker tag repo-$i repo-$i:$(date +%F); done

# 传新代码（rsync，凭据文件不会被删）→ 重建重启
pnpm docker:up
pnpm docker:ps && curl -s localhost:3000/readyz | head -c 200
```

**回滚**（无需重新构建）：

```bash
docker tag repo-api:2026-10-09 repo-api && pnpm docker:up
```

### 备份

| 对象 | 要不要备 | 说明 |
|---|---|---|
| `apps/data/.sync-state/` | ✅ 建议 | 同步进度。丢了不会脏数据，但会退化为整段重跑 |
| PostgreSQL | ✅ 建议 | `workflows` / `workflow_versions` / `skills` / `mcp_tools` / `user` |
| Qdrant 集合 | ❌ 不必 | 可由 `repos/` + 文档 + backfill 重建 |
| `deploy/*.env` | ✅ 建议 | 凭据（真源是根 `.env` JSON 总账） |
| `apps/data/repos/` | ❌ | 可从远端重新 clone |

### 配置生效方式

| 改了什么 | 如何生效 |
|---|---|
| `deploy/*.env`（凭据、调参） | `pnpm docker:up`（重建容器，不重建镜像） |
| `deploy/compose.env` 的端口/路径 | 同上 |
| `NEXT_PUBLIC_API_URL` | **必须 `pnpm docker:up` 重建 web 镜像**（构建期内联） |
| `apps/data/sync.config.yaml` | `docker compose ... restart data`（文件已 bind mount） |
| `deploy/Caddyfile` | `docker compose ... restart caddy` |

---

## 4. 故障排查（全部为实测踩过的坑）

| 症状 | 原因 | 处理 |
|---|---|---|
| `failed to read ./.env: line 1: unexpected character "{"` | compose 把根 `.env`（JSON 凭据总账）当 dotenv 解析 | 所有命令带 `--env-file deploy/compose.env`，或用 `pnpm docker:*` |
| `env file .../deploy/data.env not found` | data 的 `env_file` 是 `required: true`（凭据为硬需求） | `cp deploy/data.env.example deploy/data.env` 并填值 |
| `Error: invalid environment: REDIS_URL: Invalid url` → 容器 `Exited(1)`，反复重启 | env 文件里有 `REDIS_URL=` **留空**（空串对 `z.string().url().optional()` 是非法值） | 整行注释掉，或填真实值。ingestion/data 都会这样 |
| 登录页一直 503 `auth_unavailable` | web 的**服务端**在用 `NEXT_PUBLIC_API_URL`：容器里 `localhost` 是 web 自己（直连模式），或绕公网域名 hairpin（同源模式） | 确认 compose 给 web 注入了 `API_URL_INTERNAL=http://api:3000`；改了 `apps/web/src/lib/api.ts` 后需重建 web |
| 登录页 404 | Caddy 把 `/api/auth/*` 转给了后端 api（那是 web 自己的 route handler） | `deploy/Caddyfile` 里 `handle /api/auth/* → web` 必须排在 `handle_path /api/* → api` **之前** |
| 构建第一步 `failed to fetch anonymous token ... i/o timeout` | Dockerfile 首行的 `# syntax=docker/dockerfile:1` 强制拉 frontend 镜像，该路径可能不走代理 | 本仓已移除该指令（未用 BuildKit 专属语法）。若自行加回，需保证该镜像可拉取 |
| 构建时 `tree-sitter install: gyp ERR! not ok` → `pnpm install` 失败 | 依赖的 postinstall 要 node-gyp 编译，alpine 无 python/make/g++ | 本仓已在 `pnpm-workspace.yaml` 的 `onlyBuiltDependencies` 里**排除 tree-sitter**（仓库零引用、运行期不需要）。勿把它加回白名单 |
| data 容器日志 `detected dubious ownership in repository` | bind mount 进来的子仓库属宿主 uid，容器内是 root | 镜像已有 `git config --system --add safe.directory '*'`；自定义镜像时别漏 |
| `git fetch` 认证失败（私库） | 容器内没有凭据 | clone 时把 token 放进 remote URL（随 bind mount 进容器），或挂载 deploy key 到 `/root/.ssh` |
| Caddy 起不来 / TLS 申请失败 | 80/443 未放通、DNS 未解析到本机 | 检查 A 记录与防火墙；自测可用 `SITE_ADDRESS=localhost`（内部自签 CA） |
| 同源模式下浏览器调 API 404 | 请求 URL 漏了 `/api` 前缀 | 前端应请求 `https://<域名>/api/v1/...`；`/v1/...` 会落到 web 得到 404 |
| `pnpm test` 报 `No test files found` | 某个包有 test 脚本但没有测试文件 | 本仓 `apps/mcp` 已加 `--passWithNoTests` |

---

## 5. 安全清单（上生产前逐条确认）

- [ ] api / web / ingestion / data 的宿主绑定保持 `127.0.0.1`，**只有 Caddy 暴露 80/443**
- [ ] api **业务路由无鉴权** → 绝不直接暴露到公网
- [ ] PG(5433) / Redis(6380) / Qdrant(6333) 不暴露公网（Qdrant 是明文 HTTP + token）
- [ ] `AUTH_SECRET` 已生成且 ≥32 字符（否则登录 fail-closed）
- [ ] `GH_WEBHOOK_SECRET_STOCK_GUIDE` 与 GitHub 端一致
- [ ] `STRICT_INTEGRATIONS=true`（让配置缺失在启动时暴露，而不是静默降级）
- [ ] `deploy/*.env` 权限 600，且确认未被 git 跟踪（`git check-ignore deploy/api.env`）
- [ ] 防火墙只放 22/80/443
- [ ] 单副本：api、data 各 1（MemorySaver / 本地卷）
- [ ] 已配置 data 的定时对账（默认 5 分钟，防 webhook 丢失）

### 已知短板（部署前知情）

| 项 | 影响 |
|---|---|
| api 无鉴权中间件 | 必须靠网络层隔离（见上） |
| langgraph checkpointer = MemorySaver | 重启丢对话状态；不能多副本 |
| Langfuse 上报未实测 | 埋点代码就绪，配齐 `LANGFUSE_*` 才上报 |
| 检索缓存 TTL 内有陈旧窗口 | 文档更新后 `RAG_CACHE_TTL` 秒内可能仍是旧答案 |
| 无 e2e 测试 | CI 覆盖 typecheck/test/lint + compose 校验 + 四镜像构建 |

---

## 附录 A：环境变量速查

**api**：`PORT` `LOG_LEVEL` `STRICT_INTEGRATIONS` ｜ `REDIS_URL` `DATABASE_URL` `QDRANT_URL` `QDRANT_API_KEY` ｜ `OPENAI_API_KEY` `OPENAI_BASE_URL` ｜ `RAG_SEARCH_COLLECTIONS`（`name[@vectorName]` 逗号分隔）`RAG_CACHE_TTL` ｜ `LANGFUSE_PUBLIC_KEY` `LANGFUSE_SECRET_KEY` `LANGFUSE_HOST`

**ingestion**：`PORT` `LOG_LEVEL` `INGEST_DIR` `POLL_INTERVAL_MS` ｜ `REDIS_URL` `QDRANT_URL` `QDRANT_API_KEY` `OPENAI_API_KEY` `OPENAI_BASE_URL` ｜ `INDEX_CHUNK_SIZE` `INDEX_CHUNK_OVERLAP`（默认 512/50）

**data**：`PORT` `LOG_LEVEL` `DATA_CONFIG_PATH` `SYNC_STATE_DIR` ｜ `REDIS_URL` ｜ `QDRANT_URL` `QDRANT_API_KEY` `OPENAI_API_KEY` `OPENAI_BASE_URL` ｜ `WORKER_POLL_MS` `WORKER_LEASE_MS` `WORKER_MAX_RETRIES` `RECONCILE_INTERVAL_MS` ｜ `GH_WEBHOOK_SECRET_*`

**web（运行时）**：`AUTH_SECRET`、`API_URL_INTERNAL`（由 compose 注入）｜（构建期）`NEXT_PUBLIC_API_URL`

## 附录 B：健康检查与端点

| 端点 | 用途 |
|---|---|
| api `GET /healthz` | 存活（无依赖）。**compose healthcheck 用它** |
| api `GET /readyz` | 就绪：逐插件列出 `ready` / `disabled`(含缺失变量名) / `error`。依赖远程 infra，**不要拿它做重启判据** |
| data `GET /healthz` / `GET /readyz` | 同上（readyz 额外上报 redis 可用性） |
| ingestion | 无 health 路由，任意 HTTP 响应即证明监听存活 |
| web `GET /login` | 健康检查打这里 |

## 附录 C：data 运维 CLI

容器内：`docker compose --env-file deploy/compose.env exec data node dist/cli.js <命令>`

```
sync <repo> [--target <sha>] [--backfill] [--dry-run]
backfill <repo> [--dry-run]
cleanup <repo> [--delete-collection]
status                 # 各仓库同步状态与漂移
config-check           # 配置自检
reconcile [--once]
worker | webhook | serve
```

## 附录 D：MCP 接入（不进容器）

客户端本地跑，把知识库作为数据源给 Claude Code：

```bash
claude mcp add rag-workbench -- node <repo>/apps/mcp/dist/index.js
# 环境变量 API_URL 指向部署后的 api 地址（默认 http://localhost:3000）
```
