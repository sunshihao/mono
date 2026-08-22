import Link from "next/link";
import type { WorkflowDto } from "@repo/types";
import { api } from "@/lib/api";
import { sampleWorkflows } from "@/lib/fixtures";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WorkflowCanvas } from "@/components/workflow-canvas";
import { WorkflowEditor } from "@/components/workflow-editor";

interface Loaded {
    kind: "db";
    workflow: WorkflowDto;
}

interface LoadedSample {
    kind: "sample";
    name: string;
    description: string;
}

async function load(id: string): Promise<Loaded | LoadedSample | null> {
    const sample = sampleWorkflows.find((w) => w.id === id);
    if (sample) {
        return {
            kind: "sample",
            name: sample.name,
            description: sample.description,
        };
    }
    try {
        const res = await api.v1.workflows[":id"].$get({ param: { id } });
        if (!res.ok) return null;
        return { kind: "db", workflow: await res.json() };
    } catch {
        return null;
    }
}

export default async function WorkflowPage({
    params,
}: {
    params: { id: string };
}) {
    const loaded = await load(params.id);
    if (!loaded) {
        return (
            <main className="container mx-auto max-w-6xl space-y-4 p-6">
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
        <main className="container mx-auto max-w-6xl space-y-6 p-6">
            <div className="space-y-1">
                <Link
                    href="/"
                    className="text-sm text-muted-foreground hover:underline"
                >
                    ← 工作流列表
                </Link>
                <div className="flex items-center gap-3">
                    <h1 className="text-2xl font-bold tracking-tight">
                        {loaded.kind === "db"
                            ? loaded.workflow.name
                            : loaded.name}
                    </h1>
                    {loaded.kind === "sample" && (
                        <Badge className="border-muted text-muted-foreground">
                            内置示例（只读）
                        </Badge>
                    )}
                    {loaded.kind === "db" && (
                        <Badge>v{loaded.workflow.version}</Badge>
                    )}
                </div>
                {loaded.kind === "sample" && (
                    <p className="text-sm text-muted-foreground">
                        {loaded.description}
                    </p>
                )}
            </div>

            {loaded.kind === "db" ? (
                <WorkflowEditor workflow={loaded.workflow} />
            ) : (
                <>
                    <WorkflowCanvas
                        graph={
                            sampleWorkflows.find((w) => w.id === params.id)!
                                .graph
                        }
                        height={480}
                    />
                    <p className="text-sm text-muted-foreground">
                        示例图为只读。在列表页「新建工作流」后可编辑并保存到
                        PostgreSQL（db 插件已就绪时）。
                    </p>
                </>
            )}
        </main>
    );
}
