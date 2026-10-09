import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
    // @repo/api 仅 type-only 导入（AppType），故：
    //   1) 无需 transpilePackages；
    //   2) 在 package.json 里放在 **devDependencies**（不是 dependencies）——它只在
    //      `next build` 做类型检查时需要。若放回 dependencies，`pnpm deploy --prod`
    //      会把整个后端依赖树（drizzle/langchain/openai/llamaindex/…）打进 web 镜像，
    //      实测镜像从 ~300MB 涨到 954MB。改回前请先确认 apps/web 无非 type 导入。
    reactStrictMode: true,

    // 独立产物：next build 额外产出 .next/standalone —— 只含被实际 import 追踪到的
    // 依赖（Docker 里直接 node server.js 运行，省掉整棵生产依赖树与 @next/swc 原生包）。
    output: "standalone",
    // monorepo 必须显式指定追踪根为**仓库根**：否则以 apps/web 为界追踪，会漏掉
    // packages/types 等 workspace 依赖（登录路由用到 @repo/types 的 zod schema）。
    outputFileTracingRoot: path.join(__dirname, "../../"),
};

export default nextConfig;
