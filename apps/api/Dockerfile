# syntax=docker/dockerfile:1

# 从仓库根构建：docker build -f apps/api/Dockerfile -t repo-api .
# pnpm deploy 将包与其生产依赖打包成独立目录，免手工挑文件。
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @repo/types build \
    && pnpm --filter @repo/api build \
    && pnpm --filter @repo/api deploy --prod --legacy /out/api

FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/api .
EXPOSE 3000
# 环境变量经 --env-file 或编排注入（见 README 部署节）
CMD ["node", "dist/index.js"]
