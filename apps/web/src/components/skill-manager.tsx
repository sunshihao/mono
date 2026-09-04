"use client";

import { useCallback, useEffect, useState } from "react";
import type { SkillDto } from "@repo/types";
import { api } from "@/lib/api";
import { Badge, Button, Input, Textarea } from "@/components/ui";

/**
 * 设置页「技能」：提示词型技能的增删改/启停。
 * 画布 skill 节点经 config.refId 引用这里注册的技能执行（system 注入）。
 */
export function SkillManager() {
    const [items, setItems] = useState<SkillDto[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    // 添加表单
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [prompt, setPrompt] = useState("");

    const reload = useCallback(async () => {
        try {
            const res = await api.v1.skills.$get();
            if (!res.ok) {
                setError(`技能列表加载失败（HTTP ${res.status}）`);
                return;
            }
            const body = await res.json();
            setItems(body.skills);
            setError(null);
        } catch {
            setError("技能列表加载失败（服务端未就绪）");
        }
    }, []);

    useEffect(() => {
        void reload();
    }, [reload]);

    async function addSkill() {
        setSubmitting(true);
        setError(null);
        try {
            const res = await api.v1.skills.$post({
                json: {
                    name: name.trim(),
                    description: description.trim() || undefined,
                    prompt: prompt.trim(),
                },
            });
            if (!res.ok) {
                setError(`添加失败（HTTP ${res.status}）`);
                return;
            }
            setName("");
            setDescription("");
            setPrompt("");
            await reload();
        } catch {
            setError("添加失败（网络错误）");
        } finally {
            setSubmitting(false);
        }
    }

    async function toggle(id: string, enabled: boolean) {
        try {
            await api.v1.skills[":id"].$put({
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
            await api.v1.skills[":id"].$delete({ param: { id } });
            await reload();
        } catch {
            setError("删除失败");
        }
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold">技能（Skill）</h3>
                <span className="text-xs text-muted-foreground">
                    提示词型能力 —— 工作流「技能」节点引用，执行时注入 LLM
                </span>
                <Badge className="ml-auto border-teal-500/50 bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300">
                    {items.length} 项
                </Badge>
            </div>

            <div className="rounded-md border p-3">
                <p className="mb-2 text-sm font-medium">添加技能</p>
                <div className="space-y-2">
                    <Input
                        label="名称"
                        placeholder="名称（例如：翻译成英文）"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                    <Input
                        label="描述"
                        placeholder="描述（可选）"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                    />
                    <Textarea
                        label="指令"
                        placeholder="指令（prompt）：技能的行为定义，作为 system 指令与用户问题一起交给 LLM"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        rows={3}
                    />
                    <Button
                        onClick={() => void addSkill()}
                        disabled={submitting || !name.trim() || !prompt.trim()}
                    >
                        {submitting ? "添加中…" : "添加"}
                    </Button>
                </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <ul className="space-y-2">
                {items.length === 0 && (
                    <li className="rounded-md border p-3 text-xs text-muted-foreground">
                        还没有技能。添加后即可在工作流画布中用「技能」节点引用。
                    </li>
                )}
                {items.map((s) => (
                    <li key={s.id} className="space-y-1 rounded-md border p-3">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">
                                {s.name}
                            </span>
                            <Badge
                                className={
                                    s.enabled
                                        ? "border-emerald-500 text-emerald-700 dark:text-emerald-300"
                                        : "border-muted text-muted-foreground"
                                }
                            >
                                {s.enabled ? "已启用" : "已停用"}
                            </Badge>
                            <div className="ml-auto flex gap-1">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void toggle(s.id, s.enabled)}
                                >
                                    {s.enabled ? "停用" : "启用"}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => void remove(s.id)}
                                >
                                    删除
                                </Button>
                            </div>
                        </div>
                        {s.description && (
                            <p className="text-xs text-muted-foreground">
                                {s.description}
                            </p>
                        )}
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                            {s.prompt}
                        </p>
                    </li>
                ))}
            </ul>
        </div>
    );
}
