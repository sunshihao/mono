"use client";

import { useState } from "react";
import type { AgentMessage, RunResponse, RunStep } from "@repo/types";
import { api } from "@/lib/api";
import { isPassthrough, TYPE_META } from "@/lib/node-meta";
import {
    Badge,
    Button,
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    Input,
} from "@/components/ui";

interface RunPanelProps {
    workflowId: string;
    dirty?: boolean;
}

/** 轨迹一步的输出摘要（长答案截断，避免把面板撑高） */
function summarize(step: RunStep): string {
    if (isPassthrough(step.type)) return "直通";
    if (step.messages.length === 0) return "（无输出）";
    const first = step.messages[0]!;
    const text = first.content.replace(/\s+/g, " ").trim();
    return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

/**
 * 工作流执行面板（多轮会话式）：
 * 每轮把本地消息历史（messages）随 query 发给 POST /v1/workflows/:id/run，
 * 服务端以历史 + 新问题初始化 AgentState 重放执行，返回完整 messages。
 *
 * 除最终消息外，服务端还返回**逐节点执行轨迹**（trace）—— 多节点/带分支的图
 * 只看最终回答看不出跑了哪些节点、router 走了哪条分支，故这里单独列出。
 */
export function WorkflowRunPanel({ workflowId, dirty = false }: RunPanelProps) {
    const [query, setQuery] = useState("");
    const [messages, setMessages] = useState<AgentMessage[]>([]);
    const [trace, setTrace] = useState<RunStep[]>([]);
    const [meta, setMeta] = useState<{
        currentChannel: string;
        route?: string;
    } | null>(null);
    const [running, setRunning] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const send = async () => {
        setRunning(true);
        setError(null);
        const history = messages;
        setMessages((prev) => [...prev, { role: "user", content: query }]);
        setQuery("");
        try {
            const res = await api.v1.workflows[":id"].run.$post({
                param: { id: workflowId },
                json: {
                    query,
                    ...(history.length > 0 ? { messages: history } : {}),
                },
            });
            if (!res.ok) {
                setError(`执行失败（HTTP ${res.status}）`);
                return;
            }
            const state: RunResponse = await res.json();
            setMessages(state.messages);
            setTrace(state.trace);
            setMeta({
                currentChannel: state.currentChannel,
                ...(state.route !== undefined ? { route: state.route } : {}),
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : "执行失败");
        } finally {
            setRunning(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>运行工作流</CardTitle>
                <CardDescription>
                    多轮会话：每轮携带完整消息历史重放执行（MemorySaver
                    checkpointer）
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex gap-2">
                    <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="输入问题，例如：星尘协议的核心概念有哪些？"
                        onKeyDown={(e) => {
                            if (e.key === "Enter") void send();
                        }}
                    />
                    <Button
                        onClick={() => void send()}
                        disabled={running || !query.trim() || dirty}
                    >
                        {running ? "执行中…" : dirty ? "请先保存" : "发送"}
                    </Button>
                </div>
                {dirty && (
                    <p className="text-xs text-muted-foreground">
                        画布有未保存的更改——运行使用服务端已保存的版本，请先保存。
                    </p>
                )}
                {error && <p className="text-sm text-destructive">{error}</p>}

                {trace.length > 0 && (
                    <details
                        open
                        className="rounded-md border border-base-300 p-3"
                    >
                        <summary className="cursor-pointer text-sm font-medium">
                            执行过程
                            <span className="ml-2 text-xs font-normal text-muted-foreground">
                                {trace.length} 步
                                {meta &&
                                    ` · 分支 ${
                                        meta.route ?? meta.currentChannel
                                    }`}
                            </span>
                        </summary>
                        <ol className="mt-3 space-y-2">
                            {trace.map((step, i) => (
                                <li
                                    key={`${step.nodeId}-${i}`}
                                    className="flex items-start gap-2 text-xs"
                                >
                                    <span className="w-4 shrink-0 text-right text-muted-foreground">
                                        {i + 1}
                                    </span>
                                    <Badge
                                        className={`shrink-0 ${TYPE_META[step.type].className}`}
                                    >
                                        {TYPE_META[step.type].label}
                                    </Badge>
                                    <span className="shrink-0 font-medium">
                                        {step.label ?? step.nodeId}
                                    </span>
                                    <span className="text-muted-foreground">
                                        {summarize(step)}
                                    </span>
                                </li>
                            ))}
                        </ol>
                        {meta && (
                            <p className="mt-3 text-xs text-muted-foreground">
                                走的分支：
                                <code className="ml-1">
                                    {meta.route ?? meta.currentChannel}
                                </code>
                                {meta.route === undefined &&
                                    "（state.route 未设置，取 currentChannel 默认值）"}
                            </p>
                        )}
                    </details>
                )}

                {messages.length > 0 && (
                    <div className="max-h-96 space-y-3 overflow-y-auto rounded-md border border-base-300 p-4">
                        {messages.map((m, i) => (
                            <div
                                key={i}
                                className={
                                    m.role === "user"
                                        ? "ml-auto max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
                                        : "max-w-[85%] whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-sm"
                                }
                            >
                                {m.content}
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
