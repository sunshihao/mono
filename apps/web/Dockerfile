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
# next.config.mjs 里 output:"standalone"，故 build 后无需 pnpm deploy：
# 产物 .next/standalone 已自带最小 node_modules（Next 按实际 import 追踪）
RUN pnpm --filter @repo/types build \
    && pnpm --filter @repo/api build \
    && pnpm --filter @repo/web build

FROM node:22-alpine AS runner
ENV NODE_ENV=production
# standalone 的 server.js 读 PORT / HOSTNAME。
# HOSTNAME 必须显式覆盖：Docker 默认把容器 ID 塞进这个变量，不覆盖会绑错地址。
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
WORKDIR /app
# standalone 产物：因 next.config.mjs 的 outputFileTracingRoot 指向仓库根，
# 内部保留了 apps/web/ 这一层路径，故 server.js 在 apps/web/server.js。
COPY --from=build /repo/apps/web/.next/standalone ./
# 静态资源与 public 不在 standalone 内，需手工放到 server.js 同级对应位置
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
EXPOSE 3001
CMD ["node", "apps/web/server.js"]
