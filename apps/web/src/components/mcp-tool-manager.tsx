"use client";

import { useCallback, useEffect, useState } from "react";
import type { McpToolDto } from "@repo/types";
import { api } from "@/lib/api";
import { Badge, Button, Input, Option, Select } from "@/components/ui";

/**
 * 设置页「MCP」：外部工具端点的注册/启停。
 * 把 MCP/外部服务工具声明为 HTTP 调用（与 apps/mcp 内部实现同构）；
 * 画布 mcp 节点经 config.refId 引用执行，url 支持 {query} 占位符。
 */
export function McpToolManager() {
    const [items, setItems] = useState<McpToolDto[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [method, setMethod] = useState<"GET" | "POST">("GET");
    const [url, setUrl] = useState("");

    const reload = useCallback(async () => {
        try {
            const res = await api.v1["mcp-tools"].$get();
            if (!res.ok) {
                setError(`工具列表加载失败（HTTP ${res.status}）`);
                return;
            }
            const body = await res.json();
            setItems(body.tools);
            setError(null);
        } catch {
            setError("工具列表加载失败（服务端未就绪）");
        }
    }, []);

    useEffect(() => {
        void reload();
    }, [reload]);

    async function addTool() {
        setSubmitting(true);
        setError(null);
        try {
            const res = await api.v1["mcp-tools"].$post({
                json: {
                    name: name.trim(),
                    description: description.trim() || undefined,
                    method,
                    url: url.trim(),
                },
            });
            if (!res.ok) {
                setError(`添加失败（HTTP ${res.status}）`);
                return;
            }
            setName("");
            setDescription("");
            setUrl("");
            await reload();
        } catch {
            setError("添加失败（网络错误）");
        } finally {
            setSubmitting(false);
        }
    }

    async function toggle(id: string, enabled: boolean) {
        try {
            await api.v1["mcp-tools"][":id"].$put({
                param: { id },
                json: { enabled: !enabled },
            });
            await reload();
        } catch {
            setError("更新失败");
        }
    }

    async function remove(id: string) {
        try {
            await api.v1["mcp-tools"][":id"].$delete({ param: { id } });
            await reload();
        } catch {
            setError("删除失败");
        }
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold">MCP 工具</h3>
                <span className="text-xs text-muted-foreground">
                    外部工具端点注册 —— 工作流「MCP」节点引用执行
                </span>
                <Badge className="ml-auto border-fuchsia-500/50 bg-fuchsia-50 text-fuchsia-700 dark:bg-fuchsia-950 dark:text-fuchsia-300">
                    {items.length} 项
                </Badge>
            </div>

            <div className="rounded-md border p-3">
                <p className="mb-2 text-sm font-medium">注册工具端点</p>
                <div className="space-y-2">
                    <Input
                        placeholder="名称（例如：rag-workbench search_knowledge）"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                    <Input
                        placeholder="描述（可选）"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                    />
                    <div className="flex gap-2">
                        <Select
                            label="HTTP 方法"
                            value={method}
                            onChange={(v) =>
                                setMethod((v as "GET" | "POST") ?? "GET")
                            }
                            containerClassName="w-auto min-w-0"
                        >
                            <Option value="GET">GET</Option>
                            <Option value="POST">POST</Option>
                        </Select>
                        <Input
                            placeholder="URL（{query} 会被替换为用户问题，例如 https://api.example.com/search?q={query}）"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                        />
                    </div>
                    <Button
                        onClick={() => void addTool()}
                        disabled={submitting || !name.trim() || !url.trim()}
                    >
                        {submitting ? "注册中…" : "注册"}
                    </Button>
                </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <ul className="space-y-2">
                {items.length === 0 && (
                    <li className="rounded-md border p-3 text-xs text-muted-foreground">
                        还没有工具。注册后即可在工作流画布中用「MCP」节点引用
                        （rag-workbench 的 4 个工具即 HTTP
                        端点形态，见下方说明）。
                    </li>
                )}
                {items.map((t) => (
                    <li key={t.id} className="space-y-1 rounded-md border p-3">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">
                                {t.name}
                            </span>
                            <Badge className="border-muted font-mono text-muted-foreground">
                                {t.method}
                            </Badge>
                            <Badge
                                className={
                                    t.enabled
                                        ? "border-emerald-500 text-emerald-700 dark:text-emerald-300"
                                        : "border-muted text-muted-foreground"
                                }
                            >
                                {t.enabled ? "已启用" : "已停用"}
                            </Badge>
                            <div className="ml-auto flex gap-1">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void toggle(t.id, t.enabled)}
                                >
                                    {t.enabled ? "停用" : "启用"}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => void remove(t.id)}
                                >
                                    删除
                                </Button>
                            </div>
                        </div>
                        {t.description && (
                            <p className="text-xs text-muted-foreground">
                                {t.description}
                            </p>
                        )}
                        <p className="truncate font-mono text-xs text-muted-foreground">
                            {t.url}
                        </p>
                    </li>
                ))}
            </ul>
        </div>
    );
}
