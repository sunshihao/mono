import Link from "next/link";
import { redirect } from "next/navigation";
import type { WorkflowDto } from "@repo/types";
import { api } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { sampleWorkflows } from "@/lib/fixtures";
import {
    Badge,
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui";
import { HomeTabs } from "@/components/home-tabs";
import { RetrievalPanel } from "@/components/retrieval-panel";
import { SettingsPanel } from "@/components/settings-panel";
import { NewWorkflowButton } from "@/components/new-workflow-button";
import { DeleteWorkflowButton } from "@/components/delete-workflow-button";
import { cn } from "@/lib/cn";

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
    // 登录守卫：未登录一律重定向到 /login（redirect 抛异常中断渲染，勿包 try/catch）
    const session = getSession();
    if (!session) redirect("/login");

    const { workflows, unavailable } = await loadWorkflows();

    return (
        <main className="container mx-auto max-w-5xl p-6">
            <HomeTabs
                knowledge={<RetrievalPanel />}
                workflows={<WorkflowSection {...{ workflows, unavailable }} />}
                settings={<SettingsPanel />}
            />
        </main>
    );
}

/** tab2 工作流：列表 + 新建 + 示例降级 */
function WorkflowSection({
    workflows,
    unavailable,
}: {
    workflows: WorkflowDto[];
    unavailable: boolean;
}) {
    return (
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
                    PostgreSQL 未配置（db 插件 disabled），工作流列表不可用；
                    配置 <code>DATABASE_URL</code>{" "}
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
        // 删除钮放在 <Link> 之外作兄弟节点：<button> 嵌 <a> 是非法 HTML（React 会告警），
        // 且点击会冒泡触发跳转。独立绝对定位层既不需要 preventDefault 也不需要
        // stopPropagation，也躲开了 Cmd/中键点击绕过 onClick 的竞态。
        <div className="relative">
            <Link href={`/workflows/${id}`} className="block h-full">
                <Card className="h-full transition-colors hover:bg-base-200/50">
                    <CardHeader>
                        <CardTitle
                            className={cn(
                                "flex items-center justify-between text-base",
                                // 给右上角删除钮留位，避免长名称压到按钮下
                                !sample && "pr-6",
                            )}
                        >
                            <span className="truncate">{name}</span>
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
            {/* 示例不在库中（id 非 uuid），删除会被 param 校验挡下，故不渲染入口 */}
            {!sample && (
                <DeleteWorkflowButton
                    id={id}
                    name={name}
                    variant="icon"
                    className="absolute right-2 top-2 z-10"
                />
            )}
        </div>
    );
}
