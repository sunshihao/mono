# 注：原 `# syntax=docker/dockerfile:1` 已移除——本仓 Dockerfile 未使用任何 BuildKit 专属语法，
# 而该指令会强制 BuildKit 先从 Docker Hub 拉 frontend 镜像 docker/dockerfile:1（实测该路径在
# 国内网络/无代理时直接 i/o timeout，构建第一步即失败）。

# 从仓库根构建：docker build -f apps/data/Dockerfile -t repo-data .
# pnpm deploy 将包与其生产依赖打包成独立目录，免手工挑文件。
#
# 与 api/ingestion 的三个差异（部署时注意）：
#   1. 镜像内需要 git 二进制（src/git.ts 全部经子进程 execFile("git") 调 diff/fetch/cat-file）；
#      openssh-client 供私有仓库走 SSH deploy key 时使用。
#   2. 子仓库（repos/）与同步状态（.sync-state/）**不做进镜像**——它们是运行期状态，
#      由宿主机 clone/submodule 后 bind mount 到 /app/repos 与 /app/.sync-state
#      （进程 cwd=/app 是 local_path / SYNC_STATE_DIR 的相对基准）。
#   3. sync.config.yaml 打进镜像作为默认值，同时约定可经 -v 挂载同名路径覆盖。
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @repo/data build \
    && pnpm --filter @repo/data deploy --prod --legacy /out/data

FROM node:22-alpine AS runner
# git：同步管线必需（diff/fetch/cat-file 全走子进程）。
# openssh-client + ca-certificates：私有仓库走 SSH deploy key / HTTPS 远端时需要。
# safe.directory：bind mount 进来的子仓库属宿主 uid 所有，与容器内 root 不一致时
# git 会以 "detected dubious ownership" 拒绝一切操作；显式放行（容器内隔离，风险可控）。
RUN apk add --no-cache git openssh-client ca-certificates \
    && git config --system --add safe.directory '*'
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/data .
# 默认同步配置（仓库↔collection 映射真源）；compose 会用宿主机同名文件覆盖挂载
COPY --from=build /repo/apps/data/sync.config.yaml ./sync.config.yaml
EXPOSE 3003
# 环境变量经 --env-file 注入或挂载 /app/.env（内容清单见根 README 部署节）
CMD ["node", "--env-file-if-exists=.env", "dist/index.js"]
