# 注：原 `# syntax=docker/dockerfile:1` 已移除——本仓 Dockerfile 未使用任何 BuildKit 专属语法，
# 而该指令会强制 BuildKit 先从 Docker Hub 拉 frontend 镜像 docker/dockerfile:1（实测该路径在
# 国内网络/无代理时直接 i/o timeout，构建第一步即失败）。

# 从仓库根构建：docker build -f apps/ingestion/Dockerfile -t repo-ingestion .
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @repo/types build \
    && pnpm --filter @repo/ingestion build \
    && pnpm --filter @repo/ingestion deploy --prod --legacy /out/ingestion

FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/ingestion .
EXPOSE 3002
# 环境变量经 --env-file 注入或挂载 /app/.env（内容清单见根 README 部署节）
CMD ["node", "--env-file-if-exists=.env", "dist/index.js"]
