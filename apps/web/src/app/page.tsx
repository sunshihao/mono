import Link from "next/link";
import type { WorkflowDto } from "@repo/types";
import { api } from "@/lib/api";
import { sampleWorkflows } from "@/lib/fixtures";
import { Badge } from "@/components/ui/badge";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { RetrievalPanel } from "@/components/retrieval-panel";
import { NewWorkflowButton } from "@/components/new-workflow-button";

interface WorkflowList {
    workflows: WorkflowDto[];
    /** db 插件未配置（503）时为 true */
    unavailable: boolean;
}

async function loadWorkflows(): Promise<WorkflowList> {
    try {
        const res = await api.v1.workflows.$get();
        if (res.status === 503) return { workflows: [], unavailable: true };
        if (!res.ok) return { workflows: [], unavailable: true };
        const body = await res.json();
        return { workflows: body.workflows, unavailable: false };
    } catch {
        // 后端未启动等网络错误：与"元数据未配置"同样优雅降级
        return { workflows: [], unavailable: true };
    }
}

export default async function HomePage() {
    const { workflows, unavailable } = await loadWorkflows();

    return (
        <main className="container mx-auto max-w-5xl space-y-8 p-6">
            <header className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tight">
                    RAG 工作台
                </h1>
                {/*<p className="text-muted-foreground">
                    Hono 网关 · LangGraph 编排 · LlamaIndexTS + Qdrant 检索
                </p>*/}
            </header>

            <RetrievalPanel />

            <section className="space-y-4">
                <div className="flex items-center gap-3">
                    <h2 className="text-xl font-semibold">工作流</h2>
                    {unavailable && (
                        <Badge className="border-muted text-muted-foreground">
                            元数据未配置（以下为内置示例）
                        </Badge>
                    )}
                    <div className="ml-auto">
                        <NewWorkflowButton />
                    </div>
                </div>
                {unavailable && (
                    <p className="text-sm text-muted-foreground">
                        PostgreSQL 未配置（db 插件
                        disabled），工作流列表不可用； 配置{" "}
                        <code>DATABASE_URL</code>{" "}
                        后将展示真实数据。示例图仍可在画布中浏览。
                    </p>
                )}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {workflows.map((wf) => (
                        <WorkflowCard
                            key={wf.id}
                            id={wf.id}
                            name={wf.name}
                            description={`${wf.graph.nodes.length} 个节点 · v${wf.version}`}
                        />
                    ))}
                    {unavailable &&
                        sampleWorkflows.map((wf) => (
                            <WorkflowCard
                                key={wf.id}
                                id={wf.id}
                                name={wf.name}
                                description={wf.description}
                                sample
                            />
                        ))}
                </div>
            </section>
        </main>
    );
}

function WorkflowCard({
    id,
    name,
    description,
    sample,
}: {
    id: string;
    name: string;
    description: string;
    sample?: boolean;
}) {
    return (
        <Link href={`/workflows/${id}`}>
            <Card className="h-full transition-colors hover:bg-accent/50">
                <CardHeader>
                    <CardTitle className="flex items-center justify-between text-base">
                        {name}
                        {sample && (
                            <Badge className="border-muted text-muted-foreground">
                                示例
                            </Badge>
                        )}
                    </CardTitle>
                    <CardDescription>{description}</CardDescription>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                    打开画布 →
                </CardContent>
            </Card>
        </Link>
    );
}
