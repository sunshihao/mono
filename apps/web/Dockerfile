# syntax=docker/dockerfile:1

# 从仓库根构建：docker build -f apps/web/Dockerfile -t repo-web .
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
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
