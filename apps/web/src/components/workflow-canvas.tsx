"use client";

import { useMemo } from "react";
import {
    Background,
    Controls,
    ReactFlow,
    type Edge,
    type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { WorkflowGraph, WorkflowNodeType } from "@repo/types";
import { cn } from "@/lib/cn";

const TYPE_META: Record<
    WorkflowNodeType,
    { label: string; className: string }
> = {
    start: { label: "开始", className: "border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },
    llm: { label: "LLM", className: "border-violet-500 bg-violet-50 text-violet-800 dark:bg-violet-950 dark:text-violet-200" },
    retrieve: { label: "检索", className: "border-sky-500 bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-200" },
    router: { label: "路由", className: "border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200" },
    end: { label: "结束", className: "border-rose-500 bg-rose-50 text-rose-800 dark:bg-rose-950 dark:text-rose-200" },
};

/**
 * React Flow 画布：把 WorkflowGraph 渲染为节点/边。
 * 节点按声明顺序网格排布；router 条件边高亮并标注 condition（= 路由键）。
 */
export function WorkflowCanvas({ graph }: { graph: WorkflowGraph }) {
    const nodes: Node[] = useMemo(
        () =>
            graph.nodes.map((n, i) => ({
                id: n.id,
                position: { x: (i % 3) * 240, y: Math.floor(i / 3) * 140 },
                data: { label: n.label ?? TYPE_META[n.type].label },
                className: cn(
                    "rounded-md border-2 px-3 py-2 text-sm font-medium shadow-sm",
                    TYPE_META[n.type].className,
                ),
            })),
        [graph],
    );

    const edges: Edge[] = useMemo(
        () =>
            graph.edges.map((e) => ({
                id: e.id,
                source: e.source,
                target: e.target,
                label: e.condition,
                animated: Boolean(e.condition),
            })),
        [graph],
    );

    return (
        <div className="h-[480px] w-full rounded-lg border bg-background">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                fitView
                nodesDraggable
                nodesConnectable={false}
                proOptions={{ hideAttribution: true }}
            >
                <Background />
                <Controls />
            </ReactFlow>
        </div>
    );
}
