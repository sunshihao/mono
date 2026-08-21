import { Hono } from "hono";
import { trace } from "@opentelemetry/api";
import { z } from "zod";
import type { AppEnv, ObservabilityService } from "../../types.js";
import { getSdk } from "../../telemetry/init.js";
import type { Plugin } from "../types.js";

const ConfigSchema = z.object({
    LANGFUSE_PUBLIC_KEY: z.string().min(1),
    LANGFUSE_SECRET_KEY: z.string().min(1),
    LANGFUSE_HOST: z.string().url().optional(),
});

interface FlushableTracerProvider {
    forceFlush(): Promise<void>;
}

/**
 * Langfuse v5（OTel 架构）可观测性插件。
 * SDK 本身在 telemetry/init.ts 于模块加载期启动（早于一切被插桩模块），
 * 本插件只负责暴露 tracer / flush，并把 SDK shutdown 挂进优雅停机链。
 */
export const observabilityPlugin: Plugin<ObservabilityService> = {
    name: "observability",
    version: "0.1.0",
    configSchema: ConfigSchema,
    async init(ctx) {
        // ctx.cfg 已经过 configSchema 校验，SDK 是否可用才是本插件的开关
        void ctx;
        const sdk = getSdk();
        if (!sdk) {
            return {
                disabled: true,
                reason: "OTel SDK not initialized (see startup log)",
            };
        }
        const tracer = trace.getTracer("@repo/api");
        ctx.onShutdown(async () => {
            await sdk.shutdown();
        });
        return {
            tracer,
            flush: async () => {
                const provider = trace.getTracerProvider();
                // OTel API 层类型不含 forceFlush，运行时才有
                const flushable =
                    provider as unknown as FlushableTracerProvider | null;
                if (flushable && typeof flushable.forceFlush === "function") {
                    await flushable.forceFlush();
                }
            },
        };
    },
    // 插件路由演示：挂载在 /v1/observability，经 getServices 读取自身服务状态。
    // 注意：basePath() 返回 clone，必须先设 basePath 再注册路由。
    routes: (getServices) => {
        const sub = new Hono<AppEnv>().basePath("/v1/observability");
        sub.get("/status", (c) => {
            const service = getServices().observability;
            return c.json({ provider: "langfuse", enabled: service !== null });
        });
        return sub;
    },
};
