"use client";

import { useState } from "react";
import type { AgentMessage, WorkflowGraph } from "@repo/types";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface RunPanelProps {
    workflowId: string;
    /** 服务端已保存的图（dirty 未保存时提示先保存） */
    graph: WorkflowGraph;
    dirty?: boolean;
}

/**
 * 工作流执行面板（多轮会话式）：
 * 每轮把本地消息历史（messages）随 query 发给 POST /v1/workflows/:id/run，
 * 服务端以历史 + 新问题初始化 AgentState 重放执行，返回完整 messages。
 */
export function WorkflowRunPanel({ workflowId, dirty = false }: RunPanelProps) {
    const [query, setQuery] = useState("");
    const [messages, setMessages] = useState<AgentMessage[]>([]);
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
                json: { query, ...(history.length > 0 ? { messages: history } : {}) },
            });
            if (!res.ok) {
                setError(`执行失败（HTTP ${res.status}）`);
                return;
            }
            const state = await res.json();
            setMessages(state.messages);
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
                    多轮会话：每轮携带完整消息历史重放执行（MemorySaver checkpointer）
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
                {messages.length > 0 && (
                    <div className="max-h-96 space-y-3 overflow-y-auto rounded-md border p-4">
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
