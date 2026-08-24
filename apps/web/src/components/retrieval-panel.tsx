"use client";

import { useState } from "react";
import type { QueryResponse } from "@repo/types";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import ReactMarkdown from "react-markdown";
import { Input } from "@/components/ui/input";

/**
 * 检索问答面板：hono/client 调用 POST /v1/retrieval/query（真实 RAG 管线）。
 * 后端集成未配置时展示降级 stub 的契约形状。
 */
export function RetrievalPanel() {
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<QueryResponse | null>(null);
    const [error, setError] = useState<string | null>(null);

    const submit = async (): Promise<void> => {
        setLoading(true);
        setError(null);
        try {
            const res = await api.v1.retrieval.query.$post({ json: { query } });
            if (!res.ok) {
                setError(`请求失败（HTTP ${res.status}）`);
                return;
            }
            setResult(await res.json());
        } catch (err) {
            setError(err instanceof Error ? err.message : "请求失败");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>知识库问答</CardTitle>
                <CardDescription>
                    {/*检索管线：text-embedding-v4 嵌入 → Qdrant 检索 → qwen-plus
                    合成*/}
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex gap-2">
                    <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="例如：Agent、Chatbot、Workflow、Copilot 有什么区别？"
                        onKeyDown={(e) => {
                            if (e.key === "Enter") void submit();
                        }}
                    />
                    <Button
                        onClick={() => void submit()}
                        disabled={loading || !query.trim()}
                    >
                        {loading ? "查询中…" : "提问"}
                    </Button>
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                {result && (
                    <div className="space-y-3">
                        <Badge
                            className={
                                result.disabled
                                    ? "border-muted text-muted-foreground"
                                    : "border-emerald-500 text-emerald-700 dark:text-emerald-300"
                            }
                        >
                            {result.disabled ? "降级响应" : result.provider}
                        </Badge>
                        <p className="whitespace-pre-wrap text-sm leading-relaxed">
                            {result.answer ? (
                                <ReactMarkdown>{result.answer}</ReactMarkdown>
                            ) : (
                                "（无答案）"
                            )}
                        </p>
                        {result.sources.length > 0 && (
                            <ul className="space-y-1 text-xs text-muted-foreground">
                                {result.sources.map((s, i) => (
                                    <li key={i}>
                                        {s.file_name}（
                                        {(s.score ?? 0).toFixed(3)}）
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
