# syntax=docker/dockerfile:1

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
