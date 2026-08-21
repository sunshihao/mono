/**
 * OTel SDK 的启动点。ESM 会提升 import，被插桩模块（http/ioredis 等）只要在
 * 本模块之后加载就会被正确 patch —— 因此入口 index.ts 的第一行必须 import 本模块。
 * 只有配了 Langfuse 密钥才真正创建 SDK，否则 no-op（保持本地开发零依赖启动）。
 */
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { IORedisInstrumentation } from "@opentelemetry/instrumentation-ioredis";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { NodeSDK } from "@opentelemetry/sdk-node";

let sdk: NodeSDK | null = null;

const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
const secretKey = process.env.LANGFUSE_SECRET_KEY;

if (publicKey && secretKey) {
    try {
        // v5：Langfuse 以 SpanProcessor 接入 OTel 管线（自带批处理与 flush）
        sdk = new NodeSDK({
            spanProcessors: [
                new LangfuseSpanProcessor({
                    publicKey,
                    secretKey,
                    baseUrl: process.env.LANGFUSE_HOST,
                }),
            ],
            instrumentations: [
                new HttpInstrumentation(),
                new IORedisInstrumentation(),
            ],
        });
        sdk.start();
    } catch (err) {
        console.error("[telemetry] failed to start OTel SDK:", err);
    }
}

export function getSdk(): NodeSDK | null {
    return sdk;
}
