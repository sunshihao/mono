"use client";

import { useEffect, useRef, useState } from "react";
import type { QueryResponse, SourceRef } from "@repo/types";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import ReactMarkdown from "react-markdown";

interface ChatMessage {
    role: "user" | "assistant";
    content: string;
    sources?: SourceRef[];
    /** 后端管线降级标记（stub 应答） */
    disabled?: boolean;
    provider?: string;
}

/**
 * 知识库问答（聊天形态）：hono/client 调用 POST /v1/retrieval/query
 * （真实 RAG 管线，非流式整答）。多轮历史保留在本地面板内，
 * 每轮独立检索——后端未集成时展示降级 stub 的契约形状。
 */
export function RetrievalPanel() {
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [error, setError] = useState<string | null>(null);
    const bottomRef = useRef<HTMLDivElement>(null);

    // 新消息/加载占位出现时滚动到底部
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, loading]);

    async function submit(): Promise<void> {
        const query = input.trim();
        if (!query || loading) return;
        setInput("");
        setError(null);
        setLoading(true);
        setMessages((prev) => [...prev, { role: "user", content: query }]);
        try {
            const res = await api.v1.retrieval.query.$post({
                json: { query },
            });
            if (!res.ok) throw new Error(`请求失败（HTTP ${res.status}）`);
            const data: QueryResponse = await res.json();
            setMessages((prev) => [
                ...prev,
                {
                    role: "assistant",
                    content: data.answer ?? "（无答案）",
                    sources: data.sources,
                    disabled: data.disabled,
                    provider: data.provider,
                },
            ]);
        } catch (err) {
            setError(err instanceof Error ? err.message : "请求失败");
        } finally {
            setLoading(false);
        }
    }

    return (
        <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                    <CardTitle>知识库问答</CardTitle>
                    <CardDescription>
                        text-embedding-v4 嵌入 → Qdrant 检索 → qwen-plus 合成
                    </CardDescription>
                </div>
                {messages.length > 0 && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setMessages([])}
                    >
                        清空对话
                    </Button>
                )}
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
                    {messages.length === 0 && (
                        <p className="py-8 text-center text-sm text-muted-foreground">
                            有什么想问知识库的？例如：Agent、Chatbot、
                            Workflow、Copilot 有什么区别？
                        </p>
                    )}
                    {messages.map((m, i) => (
                        <MessageBubble key={i} message={m} />
                    ))}
                    {loading && (
                        <div className="flex justify-start">
                            <div className="flex max-w-[80%] items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground">
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                                正在检索…
                            </div>
                        </div>
                    )}
                    {error && (
                        <p className="text-sm text-destructive">{error}</p>
                    )}
                    <div ref={bottomRef} />
                </div>

                <div className="flex items-end gap-2">
                    <Textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="输入问题，Enter 发送，Shift+Enter 换行"
                        className="min-h-[44px]"
                        rows={1}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                void submit();
                            }
                        }}
                        disabled={loading}
                    />
                    <Button
                        onClick={() => void submit()}
                        disabled={loading || !input.trim()}
                    >
                        {loading ? "检索中…" : "发送"}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}

/** 单条聊天气泡：user 右对齐主色，assistant 左对齐卡片色 + markdown + 来源 */
function MessageBubble({ message }: { message: ChatMessage }) {
    const isUser = message.role === "user";
    return (
        <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
            <div
                className={cn(
                    "max-w-[80%] space-y-2 rounded-lg px-3 py-2 text-sm leading-relaxed",
                    isUser
                        ? "bg-primary text-primary-foreground"
                        : "border bg-card",
                )}
            >
                {message.content && (
                    <div className="whitespace-pre-wrap">
                        <ReactMarkdown>{message.content}</ReactMarkdown>
                    </div>
                )}
                {!isUser && (message.provider || message.disabled) && (
                    <div className="flex items-center gap-2">
                        <Badge
                            className={
                                message.disabled
                                    ? "border-muted text-muted-foreground"
                                    : "border-emerald-500 text-emerald-700 dark:text-emerald-300"
                            }
                        >
                            {message.disabled
                                ? "降级响应"
                                : (message.provider ?? "llamaindex")}
                        </Badge>
                    </div>
                )}
                {!isUser && message.sources && message.sources.length > 0 && (
                    <ul className="space-y-0.5 text-xs text-muted-foreground">
                        {message.sources.map((s, i) => (
                            <li key={i}>
                                {s.file_name}（{(s.score ?? 0).toFixed(3)}）
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
