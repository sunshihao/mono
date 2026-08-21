import { beforeEach } from "vitest";

/**
 * 测试确定性：清掉一切集成环境变量，保证插件全部走"未配置 → disabled"路径，
 * 不被本机 shell 环境污染。
 */
const INTEGRATION_VARS = [
    "REDIS_URL",
    "DATABASE_URL",
    "QDRANT_URL",
    "QDRANT_API_KEY",
    "LANGFUSE_PUBLIC_KEY",
    "LANGFUSE_SECRET_KEY",
    "LANGFUSE_HOST",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "STRICT_INTEGRATIONS",
];

function clearIntegrationEnv(): void {
    for (const key of INTEGRATION_VARS) {
        delete process.env[key];
    }
    // 测试静音访问日志（createApp 的默认 logger 尊重 LOG_LEVEL）
    process.env.LOG_LEVEL = "silent";
}

// setupFiles 先于测试文件模块图执行 —— 必须在模块顶层清理：
// telemetry/init.ts 等在 import 时读取 env，若只靠 beforeEach 就晚了。
clearIntegrationEnv();

beforeEach(() => {
    clearIntegrationEnv();
});
