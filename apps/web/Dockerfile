# 注：原 `# syntax=docker/dockerfile:1` 已移除——本仓 Dockerfile 未使用任何 BuildKit 专属语法，
# 而该指令会强制 BuildKit 先从 Docker Hub 拉 frontend 镜像 docker/dockerfile:1（实测该路径在
# 国内网络/无代理时直接 i/o timeout，构建第一步即失败）。

# 从仓库根构建：docker build -f apps/web/Dockerfile -t repo-web .
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
# NEXT_PUBLIC_API_URL 为构建期内联（Next 约定），docker build 时经 --build-arg 注入
ARG NEXT_PUBLIC_API_URL=http://localhost:3000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @repo/types build \
    && pnpm --filter @repo/api build \
    && pnpm --filter @repo/web build \
    && pnpm --filter @repo/web deploy --prod --legacy /out/web

FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/web .
EXPOSE 3001
# 前端连接 API 的地址（构建期注入 NEXT_PUBLIC_API_URL 更佳）
CMD ["node_modules/.bin/next", "start", "-p", "3001"]
