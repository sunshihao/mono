import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ConfigError } from "../src/lib/errors.js";
import { PluginRegistry, type Plugin } from "../src/plugins/index.js";
import { redisPlugin } from "../src/plugins/redis/index.js";

/** 测试用假插件：名字必须取自 Services 的 key（编译期约束），服务体用空对象占位 */
function fakePlugin(
    name: "redis" | "db",
    init: Plugin["init"],
    extra: Partial<Plugin> = {},
): Plugin {
    return {
        name,
        version: "0.0.0",
        configSchema: z.object({}),
        init,
        ...extra,
    };
}

describe("PluginRegistry 拓扑排序", () => {
    it("按 deps 顺序初始化（依赖先于依赖者）", async () => {
        const order: string[] = [];
        const registry = new PluginRegistry(
            [
                fakePlugin(
                    "redis",
                    async () => {
                        order.push("redis");
                        return {};
                    },
                    { deps: ["db"] },
                ),
                fakePlugin("db", async () => {
                    order.push("db");
                    return {};
                }),
            ],
            { env: {} },
        );
        await registry.start();
        expect(order).toEqual(["db", "redis"]);
    });

    it("依赖环 → 抛 ConfigError", async () => {
        const registry = new PluginRegistry(
            [
                fakePlugin("redis", async () => ({}), { deps: ["db"] }),
                fakePlugin("db", async () => ({}), { deps: ["redis"] }),
            ],
            { env: {} },
        );
        const err = await registry.start().catch((e: unknown) => e);
        expect(err).toBeInstanceOf(ConfigError);
        expect((err as Error).message).toMatch(/cycle/);
    });

    it("依赖不存在的插件 → 构造即抛 ConfigError", () => {
        expect(
            () =>
                new PluginRegistry([
                    fakePlugin("redis", async () => ({}), { deps: ["qdrant"] }),
                ]),
        ).toThrowError(/unknown plugin/);
    });
});

describe("PluginRegistry 配置校验与降级", () => {
    it("缺配置 → disabled 且服务为 null，reason 点名缺失变量", async () => {
        const registry = new PluginRegistry([redisPlugin], { env: {} });
        const { services, health } = await registry.start();
        expect(services.redis).toBeNull();
        expect(await health()).toEqual([
            {
                name: "redis",
                status: "disabled",
                reason: expect.stringContaining("REDIS_URL"),
            },
        ]);
    });

    it("严格模式 → 缺配置直接抛 ConfigError 并点名插件", async () => {
        const registry = new PluginRegistry([redisPlugin], {
            env: {},
            strict: true,
        });
        await expect(registry.start()).rejects.toThrowError(
            /plugin "redis" is required but not configured/,
        );
    });

    it("init 抛错 → 非严格模式降级为 error 状态", async () => {
        const registry = new PluginRegistry(
            [
                fakePlugin("redis", async () => {
                    throw new Error("connection refused");
                }),
            ],
            { env: {} },
        );
        const { services, health } = await registry.start();
        expect(services.redis).toBeNull();
        expect(await health()).toEqual([
            { name: "redis", status: "error", reason: "connection refused" },
        ]);
    });

    it("init 返回 { disabled } → disabled 状态", async () => {
        const registry = new PluginRegistry(
            [
                fakePlugin("redis", async () => ({
                    disabled: true,
                    reason: "off by config",
                })),
            ],
            { env: {} },
        );
        const { services, health } = await registry.start();
        expect(services.redis).toBeNull();
        expect(await health()).toEqual([
            { name: "redis", status: "disabled", reason: "off by config" },
        ]);
    });

    it("init 成功 → ready，health 由插件 health 钩子决定", async () => {
        const registry = new PluginRegistry(
            [
                fakePlugin("redis", async () => ({ client: {} }), {
                    health: async () => ({ ok: false, reason: "PING failed" }),
                }),
            ],
            { env: {} },
        );
        const { services, health } = await registry.start();
        expect(services.redis).toEqual({ client: {} });
        expect(await health()).toEqual([
            { name: "redis", status: "error", reason: "PING failed" },
        ]);
    });
});

describe("PluginRegistry 生命周期", () => {
    it("dispose 按 onShutdown 注册逆序执行", async () => {
        const calls: string[] = [];
        const registry = new PluginRegistry(
            [
                fakePlugin("redis", async (ctx) => {
                    ctx.onShutdown(() => {
                        calls.push("first");
                    });
                    ctx.onShutdown(() => {
                        calls.push("second");
                    });
                    return {};
                }),
            ],
            { env: {} },
        );
        await registry.start();
        await registry.dispose();
        expect(calls).toEqual(["second", "first"]);
    });

    it("shutdown 钩子抛错不影响其余钩子", async () => {
        const calls: string[] = [];
        const registry = new PluginRegistry(
            [
                fakePlugin("redis", async (ctx) => {
                    ctx.onShutdown(() => {
                        calls.push("a");
                    });
                    ctx.onShutdown(() => {
                        calls.push("b");
                        throw new Error("boom");
                    });
                    return {};
                }),
            ],
            { env: {} },
        );
        await registry.start();
        await registry.dispose();
        expect(calls).toEqual(["b", "a"]);
    });
});
