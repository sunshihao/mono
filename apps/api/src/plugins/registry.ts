import type { PluginHealth } from "@repo/types";
import type { Services } from "../types.js";
import { ConfigError } from "../lib/errors.js";
import type { Plugin, PluginInitContext, PluginResult } from "./types.js";

export interface PluginRegistryOptions {
    /** true 时：配置缺失/校验失败/init 抛错都直接失败启动 */
    strict?: boolean;
    /** 环境变量来源（测试注入用，默认 process.env） */
    env?: NodeJS.ProcessEnv;
}

export interface RegistryState {
    services: Services;
    /** /readyz 用：逐个检查插件健康状态 */
    health(): Promise<PluginHealth[]>;
}

type PluginStatus = { status: "ready" | "disabled" | "error"; reason?: string };

function isDisabledResult(
    result: unknown,
): result is { disabled: true; reason: string } {
    return (
        typeof result === "object" &&
        result !== null &&
        (result as { disabled?: unknown }).disabled === true
    );
}

function formatIssues(error: {
    issues: { path: (string | number)[]; message: string }[];
}): string {
    return error.issues
        .map((i) => `${i.path.join(".") || "config"}: ${i.message}`)
        .join("; ");
}

/**
 * 插件注册表：
 *  1. 校验插件名唯一、依赖存在
 *  2. deps 做 Kahn topo 排序（环 → ConfigError）
 *  3. 逐个 configSchema 校验 → init；失败按 strict 降级或抛错
 *  4. dispose 按 onShutdown 注册逆序回收资源
 */
export class PluginRegistry {
    private readonly byName: Map<keyof Services, Plugin>;
    private readonly statuses = new Map<keyof Services, PluginStatus>();
    private readonly shutdownFns: Array<() => void | Promise<void>> = [];
    private services!: Services;
    private started = false;

    constructor(
        plugins: Plugin[],
        private readonly opts: PluginRegistryOptions = {},
    ) {
        this.byName = new Map(plugins.map((p) => [p.name, p]));
        if (this.byName.size !== plugins.length) {
            throw new ConfigError("duplicate plugin names detected");
        }
        for (const plugin of plugins) {
            for (const dep of plugin.deps ?? []) {
                if (!this.byName.has(dep)) {
                    throw new ConfigError(
                        `plugin "${plugin.name}" depends on unknown plugin "${dep}"`,
                    );
                }
            }
        }
    }

    async start(): Promise<RegistryState> {
        if (this.started) throw new Error("plugin registry already started");
        this.started = true;

        const order = this.topologicalSort();
        const services = {} as Services;
        for (const name of order) {
            const plugin = this.byName.get(name)!;
            const parsed = plugin.configSchema.safeParse(
                this.opts.env ?? process.env,
            );

            if (!parsed.success) {
                const reason = formatIssues(parsed.error);
                if (this.opts.strict) {
                    throw new ConfigError(
                        `plugin "${plugin.name}" is required but not configured: ${reason}`,
                    );
                }
                this.statuses.set(name, { status: "disabled", reason });
                (services as Record<keyof Services, unknown>)[name] = null;
                continue;
            }

            const ctx: PluginInitContext = {
                cfg: parsed.data,
                strict: this.opts.strict ?? false,
                onShutdown: (fn) => this.shutdownFns.push(fn),
                getServices: () => services,
            };
            try {
                const result: PluginResult<unknown> = await plugin.init(ctx);
                if (isDisabledResult(result)) {
                    this.statuses.set(name, {
                        status: "disabled",
                        reason: result.reason,
                    });
                    (services as Record<keyof Services, unknown>)[name] = null;
                } else {
                    this.statuses.set(name, { status: "ready" });
                    (services as Record<keyof Services, unknown>)[name] =
                        result;
                }
            } catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                if (this.opts.strict) {
                    throw new ConfigError(
                        `plugin "${plugin.name}" failed to initialize: ${reason}`,
                    );
                }
                this.statuses.set(name, { status: "error", reason });
                (services as Record<keyof Services, unknown>)[name] = null;
            }
        }

        this.services = services;
        return { services, health: () => this.health() };
    }

    /** 逆序执行各插件的 onShutdown 钩子（服务端优雅停机用） */
    async dispose(): Promise<void> {
        for (const fn of [...this.shutdownFns].reverse()) {
            try {
                await fn();
            } catch (err) {
                console.error("[registry] shutdown hook failed:", err);
            }
        }
    }

    async health(): Promise<PluginHealth[]> {
        const results: PluginHealth[] = [];
        for (const [name, status] of this.statuses) {
            if (status.status !== "ready") {
                results.push({
                    name,
                    status: status.status,
                    reason: status.reason,
                });
                continue;
            }
            const plugin = this.byName.get(name)!;
            if (!plugin.health) {
                results.push({ name, status: "ready" });
                continue;
            }
            try {
                const check = await plugin.health(this.services[name]!);
                results.push(
                    check.ok
                        ? { name, status: "ready" }
                        : {
                              name,
                              status: "error",
                              reason: check.reason ?? "health check failed",
                          },
                );
            } catch (err) {
                results.push({
                    name,
                    status: "error",
                    reason: err instanceof Error ? err.message : String(err),
                });
            }
        }
        return results;
    }

    private topologicalSort(): (keyof Services)[] {
        const plugins = [...this.byName.values()];
        const indegree = new Map<keyof Services, number>();
        const dependents = new Map<keyof Services, (keyof Services)[]>();

        for (const plugin of plugins) {
            indegree.set(plugin.name, plugin.deps?.length ?? 0);
            for (const dep of plugin.deps ?? []) {
                const list = dependents.get(dep) ?? [];
                list.push(plugin.name);
                dependents.set(dep, list);
            }
        }

        const queue = [...indegree.entries()]
            .filter(([, degree]) => degree === 0)
            .map(([name]) => name);
        const order: (keyof Services)[] = [];

        while (queue.length > 0) {
            const name = queue.shift()!;
            order.push(name);
            for (const next of dependents.get(name) ?? []) {
                const degree = (indegree.get(next) ?? 1) - 1;
                indegree.set(next, degree);
                if (degree === 0) queue.push(next);
            }
        }

        if (order.length !== plugins.length) {
            const cyclic = [...indegree.entries()]
                .filter(([, degree]) => degree > 0)
                .map(([name]) => name)
                .join(", ");
            throw new ConfigError(
                `plugin dependency cycle detected: ${cyclic}`,
            );
        }
        return order;
    }
}
