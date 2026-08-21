import Link from "next/link";
import type { WorkflowGraph } from "@repo/types";
import { api } from "@/lib/api";
import { sampleWorkflows } from "@/lib/fixtures";
import { Button } from "@/components/ui/button";
import { WorkflowCanvas } from "@/components/workflow-canvas";

interface LoadedGraph {
    name: string;
    graph: WorkflowGraph;
}

async function loadGraph(id: string): Promise<LoadedGraph | null> {
    const sample = sampleWorkflows.find((w) => w.id === id);
    if (sample) return { name: sample.name, graph: sample.graph };
    try {
        const res = await api.v1.workflows[":id"].$get({ param: { id } });
        if (!res.ok) return null;
        const dto = await res.json();
        return { name: dto.name, graph: dto.graph };
    } catch {
        return null;
    }
}

export default async function WorkflowPage({
    params,
}: {
    params: { id: string };
}) {
    const loaded = await loadGraph(params.id);
    if (!loaded) {
        return (
            <main className="container mx-auto max-w-5xl space-y-4 p-6">
                <h1 className="text-2xl font-bold">未找到工作流</h1>
                <p className="text-muted-foreground">
                    该 id 不在数据库中（或 db 插件未配置），也不属于内置示例。
                </p>
                <Link href="/">
                    <Button variant="outline">返回列表</Button>
                </Link>
            </main>
        );
    }

    return (
        <main className="container mx-auto max-w-5xl space-y-6 p-6">
            <div className="flex items-center justify-between">
                <div className="space-y-1">
                    <Link href="/" className="text-sm text-muted-foreground hover:underline">
                        ← 工作流列表
                    </Link>
                    <h1 className="text-2xl font-bold tracking-tight">
                        {loaded.name}
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        {loaded.graph.nodes.length} 个节点 ·{" "}
                        {loaded.graph.edges.length} 条边（画布仅浏览；执行入口为
                        POST /v1/workflows/:id/run）
                    </p>
                </div>
            </div>
            <WorkflowCanvas graph={loaded.graph} />
        </main>
    );
}
