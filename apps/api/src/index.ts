// OTel SDK 必须先于一切被插桩模块加载（ESM import 提升，详见 telemetry/init.ts），
// 因此这里是入口的第一行 import。
import "./telemetry/init.js";
import { startServer } from "./server.js";

const { app, dispose } = await startServer();
// app 只作类型导出（AppType），运行时仅用 dispose；void 标记为"有意不使用其值"
void app;
void dispose;

/**
 * hono/client 端到端类型安全 RPC 的入口类型：
 * apps/web 中 `import type { AppType } from "@repo/api"` + `hc<AppType>(...)`。
 * 注意：@repo/api 的运行时入口会启动服务器，web 只应 type-only 导入。
 */
export type AppType = typeof app;
