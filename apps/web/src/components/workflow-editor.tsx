"use client";

import { useState } from "react";
import type {
    WorkflowDto,
    WorkflowGraph,
    WorkflowVersionDto,
} from "@repo/types";
import { api } from "@/lib/api";
import { Badge, Button, Input } from "@/components/ui";
import { WorkflowCanvas } from "@/components/workflow-canvas";
import { WorkflowRunPanel } from "@/components/workflow-run-panel";

/**
 * 工作流编辑器：画布编辑 draft → 保存（PUT，version+1）→ 版本历史浏览。
 * savedGraph 为服务端最新已保存图（/run 与版本比对均基于它）。
 */
export function WorkflowEditor({ workflow }: { workflow: WorkflowDto }) {
    const [draft, setDraft] = useState<WorkflowGraph>(workflow.graph);
    const [name, setName] = useState(workflow.name);
    const [saved, setSaved] = useState<WorkflowGraph>(workflow.graph);
    const [version, setVersion] = useState(workflow.version);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [versions, setVersions] = useState<WorkflowVersionDto[]>([]);
    const [viewingVersion, setViewingVersion] = useState<number | null>(null);

    const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

    const save = async () => {
        setSaving(true);
        setMessage(null);
        try {
            const res = await api.v1.workflows[":id"].$put({
                param: { id: workflow.id },
                json: { name, graph: draft },
            });
            if (!res.ok) {
                setMessage(`保存失败（HTTP ${res.status}）`);
                return;
            }
            const dto = await res.json();
            setSaved(dto.graph);
            setVersion(dto.version);
            setViewingVersion(null);
            setMessage(`已保存 v${dto.version}`);
        } catch (err) {
            setMessage(err instanceof Error ? err.message : "保存失败");
        } finally {
            setSaving(false);
        }
    };

    const loadVersions = async () => {
        const res = await api.v1.workflows[":id"].versions.$get({
            param: { id: workflow.id },
        });
        if (res.ok) {
            const body = await res.json();
            setVersions(body.versions);
        }
    };

    const viewVersion = (v: WorkflowVersionDto) => {
        setDraft(v.graph);
        setViewingVersion(v.version);
        setMessage(
            `正在查看历史版本 v${v.version}（保存将基于该版本创建新版本）`,
        );
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-end gap-3">
                <label className="space-y-1">
                    <span className="text-xs text-muted-foreground">名称</span>
                    <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-64"
                    />
                </label>
                <Badge className="mb-2">
                    v{version}
                    {viewingVersion !== null && `（查看 v${viewingVersion}）`}
                </Badge>
                <div className="mb-2 flex items-center gap-2">
                    <Button
                        onClick={() => void save()}
                        disabled={saving || !dirty}
                    >
                        {saving ? "保存中…" : dirty ? "保存更改" : "已保存"}
                    </Button>
                    <Button
                        variant="outline"
                        onClick={() => void loadVersions()}
                    >
                        版本历史
                    </Button>
                </div>
                {message && (
                    <p className="mb-2 text-sm text-muted-foreground">
                        {message}
                    </p>
                )}
            </div>

            {versions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {versions.map((v) => (
                        <Button
                            key={v.id}
                            variant={
                                v.version === version ? "default" : "outline"
                            }
                            size="sm"
                            onClick={() => viewVersion(v)}
                        >
                            v{v.version}
                        </Button>
                    ))}
                </div>
            )}

            <WorkflowCanvas graph={draft} onChange={setDraft} height={420} />

            <WorkflowRunPanel
                workflowId={workflow.id}
                graph={saved}
                dirty={dirty}
            />
        </div>
    );
}
