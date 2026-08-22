"use client";

import { useCallback, useMemo, useState } from "react";
import {
    addEdge,
    applyEdgeChanges,
    applyNodeChanges,
    Background,
    Controls,
    ReactFlow,
    type Connection,
    type Edge,
    type EdgeChange,
    type Node,
    type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { WorkflowGraph, WorkflowNodeType } from "@repo/types";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const NODE_TYPES: WorkflowNodeType[] = [
    "start",
    "llm",
    "retrieve",
    "router",
    "end",
];

const TYPE_META: Record<
    WorkflowNodeType,
    { label: string; className: string }
> = {
    start: {
        label: "开始",
        className:
            "border-emerald-500 bg-emerald-50 dark:bg-emerald-950",
    },
    llm: {
        label: "LLM",
        className:
            "border-violet-500 bg-violet-50 dark:bg-violet-950",
    },
    retrieve: {
        label: "检索",
        className:
            "border-sky-500 bg-sky-50 dark:bg-sky-950",
    },
    router: {
        label: "路由",
        className:
            "border-amber-500 bg-amber-50 dark:bg-amber-950",
    },
    end: {
        label: "结束",
        className:
            "border-rose-500 bg-rose-50 dark:bg-rose-950",
    },
};

interface FlowNodeData extends Record<string, unknown> {
    label: string;
    nodeType: WorkflowNodeType;
}

type FlowNode = Node<FlowNodeData>;

/** WorkflowGraph ↔ React Flow 互转（画布位置不持久化） */
function graphToFlow(graph: WorkflowGraph): {
    nodes: FlowNode[];
    edges: Edge[];
} {
    const nodes: FlowNode[] = graph.nodes.map((n, i) => ({
        id: n.id,
        position: { x: (i % 3) * 240, y: Math.floor(i / 3) * 140 },
        data: { label: n.label ?? TYPE_META[n.type].label, nodeType: n.type },
        className: cn(
            "rounded-md border-2 px-3 py-2 text-sm font-medium shadow-sm",
            TYPE_META[n.type].className,
        ),
    }));
    const edges: Edge[] = graph.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.condition,
        animated: Boolean(e.condition),
    }));
    return { nodes, edges };
}

function flowToGraph(nodes: FlowNode[], edges: Edge[]): WorkflowGraph {
    return {
        nodes: nodes.map((n) => ({
            id: n.id,
            type: n.data.nodeType,
            ...(n.data.label !== TYPE_META[n.data.nodeType].label
                ? { label: n.data.label }
                : {}),
            config: {},
        })),
        edges: edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            ...(e.label ? { condition: String(e.label) } : {}),
        })),
    };
}

export interface WorkflowCanvasProps {
    graph: WorkflowGraph;
    /** 编辑模式：提供 onChange 时启用添加/连线/删除/属性编辑 */
    onChange?: (graph: WorkflowGraph) => void;
    height?: number;
}

/**
 * React Flow 画布：
 *  - 只读（无 onChange）：渲染展示
 *  - 编辑：添加 5 类节点、拖拽、连线（router 出边可设 condition）、删除、重命名
 */
export function WorkflowCanvas({
    graph,
    onChange,
    height = 480,
}: WorkflowCanvasProps) {
    const readOnly = !onChange;
    const [nodes, setNodes] = useState<FlowNode[]>(
        () => graphToFlow(graph).nodes,
    );
    const [edges, setEdges] = useState<Edge[]>(() => graphToFlow(graph).edges);
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
    const [idCounter, setIdCounter] = useState(
        graph.nodes.length + graph.edges.length,
    );

    const emit = useCallback(
        (nextNodes: FlowNode[], nextEdges: Edge[]) => {
            onChange?.(flowToGraph(nextNodes, nextEdges));
        },
        [onChange],
    );

    const onNodesChange = useCallback(
        (changes: NodeChange<FlowNode>[]) => {
            setNodes((prev) => {
                const next = applyNodeChanges(changes, prev) as FlowNode[];
                emit(next, edges);
                return next;
            });
        },
        [edges, emit],
    );

    const onEdgesChange = useCallback(
        (changes: EdgeChange<Edge>[]) => {
            setEdges((prev) => {
                const next = applyEdgeChanges(changes, prev);
                emit(nodes, next);
                return next;
            });
        },
        [nodes, emit],
    );

    const onConnect = useCallback(
        (connection: Connection) => {
            setEdges((prev) => {
                const next = addEdge(
                    {
                        ...connection,
                        id: `edge-${idCounter}`,
                        animated: connection.source
                            ? nodes.find((n) => n.id === connection.source)
                                  ?.data.nodeType === "router"
                            : false,
                    },
                    prev,
                );
                emit(nodes, next);
                setIdCounter((c) => c + 1);
                return next;
            });
        },
        [nodes, idCounter, emit],
    );

    const addNode = (type: WorkflowNodeType) => {
        const id = `node-${idCounter}`;
        const meta = TYPE_META[type];
        const created: FlowNode = {
            id,
            position: {
                x: 80 + (idCounter % 4) * 220,
                y: 80 + Math.floor(idCounter / 4) * 160,
            },
            data: { label: meta.label, nodeType: type },
            className: cn(
                "rounded-md border-2 px-3 py-2 text-sm font-medium shadow-sm",
                meta.className,
            ),
        };
        setNodes((prev) => {
            const next = [...prev, created];
            emit(next, edges);
            return next;
        });
        setIdCounter((c) => c + 1);
    };

    const deleteSelected = () => {
        if (selectedEdgeId) {
            setEdges((prev) => {
                const next = prev.filter((e) => e.id !== selectedEdgeId);
                emit(nodes, next);
                return next;
            });
            setSelectedEdgeId(null);
        }
        if (selectedNodeId) {
            const nextNodes = nodes.filter((n) => n.id !== selectedNodeId);
            const nextEdges = edges.filter(
                (e) =>
                    e.source !== selectedNodeId && e.target !== selectedNodeId,
            );
            setNodes(nextNodes);
            setEdges(nextEdges);
            emit(nextNodes, nextEdges);
            setSelectedNodeId(null);
        }
    };

    const renameSelected = (label: string) => {
        if (!selectedNodeId) return;
        setNodes((prev) => {
            const next = prev.map((n) =>
                n.id === selectedNodeId
                    ? { ...n, data: { ...n.data, label } }
                    : n,
            );
            emit(next, edges);
            return next;
        });
    };

    const setEdgeCondition = (condition: string) => {
        if (!selectedEdgeId) return;
        setEdges((prev) => {
            const next = prev.map((e) =>
                e.id === selectedEdgeId
                    ? {
                          ...e,
                          label: condition || undefined,
                          animated: Boolean(condition),
                      }
                    : e,
            );
            emit(nodes, next);
            return next;
        });
    };

    const selectedEdge = edges.find((e) => e.id === selectedEdgeId);
    const selectedNode = nodes.find((n) => n.id === selectedNodeId);
    const selectedEdgeSourceType = selectedEdge
        ? nodes.find((n) => n.id === selectedEdge.source)?.data.nodeType
        : undefined;

    const toolbar = useMemo(
        () => (
            <div className="flex flex-wrap items-center gap-2">
                {NODE_TYPES.map((t) => (
                    <Button
                        key={t}
                        variant="outline"
                        size="sm"
                        onClick={() => addNode(t)}
                    >
                        + {TYPE_META[t].label}
                    </Button>
                ))}
                <Button
                    variant="outline"
                    size="sm"
                    disabled={!selectedNodeId && !selectedEdgeId}
                    onClick={deleteSelected}
                >
                    删除选中
                </Button>
                <span className="ml-auto text-xs text-muted-foreground">
                    选中节点/边后可在右侧编辑属性
                </span>
            </div>
        ),
        [selectedNodeId, selectedEdgeId, idCounter],
    );

    return (
        <div className="space-y-3">
            {!readOnly && toolbar}
            <div className="grid gap-3 lg:grid-cols-[1fr_220px]">
                <div
                    className="h-[520px] rounded-lg border bg-background"
                    style={{ height }}
                >
                    <ReactFlow<FlowNode, Edge>
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
                        onNodeClick={(_, n) => {
                            setSelectedNodeId(n.id);
                            setSelectedEdgeId(null);
                        }}
                        onEdgeClick={(_, e) => {
                            setSelectedEdgeId(e.id);
                            setSelectedNodeId(null);
                        }}
                        onPaneClick={() => {
                            setSelectedNodeId(null);
                            setSelectedEdgeId(null);
                        }}
                        fitView
                        nodesDraggable={!readOnly}
                        nodesConnectable={!readOnly}
                        elementsSelectable={!readOnly}
                        proOptions={{ hideAttribution: true }}
                    >
                        <Background />
                        <Controls showInteractive={!readOnly} />
                    </ReactFlow>
                </div>
                {!readOnly && (
                    <aside className="space-y-4 rounded-lg border p-4 text-sm">
                        {selectedNode ? (
                            <div className="space-y-2">
                                <Badge
                                    className={
                                        TYPE_META[selectedNode.data.nodeType]
                                            .className
                                    }
                                >
                                    {
                                        TYPE_META[selectedNode.data.nodeType]
                                            .label
                                    }{" "}
                                    节点
                                </Badge>
                                <label className="block space-y-1">
                                    <span className="text-xs text-muted-foreground">
                                        名称
                                    </span>
                                    <Input
                                        value={selectedNode.data.label}
                                        onChange={(e) =>
                                            renameSelected(e.target.value)
                                        }
                                    />
                                </label>
                            </div>
                        ) : selectedEdge ? (
                            <div className="space-y-2">
                                <Badge>连线</Badge>
                                <p className="text-xs text-muted-foreground">
                                    {selectedEdge.source} →{" "}
                                    {selectedEdge.target}
                                </p>
                                {selectedEdgeSourceType === "router" ? (
                                    <label className="block space-y-1">
                                        <span className="text-xs text-muted-foreground">
                                            路由条件（condition = 路由键）
                                        </span>
                                        <Input
                                            value={String(
                                                selectedEdge.label ?? "",
                                            )}
                                            placeholder="例如 retrieval / chat"
                                            onChange={(e) =>
                                                setEdgeCondition(e.target.value)
                                            }
                                        />
                                    </label>
                                ) : (
                                    <p className="text-xs text-muted-foreground">
                                        仅 router 节点的出边可设置路由条件
                                    </p>
                                )}
                            </div>
                        ) : (
                            <p className="text-xs text-muted-foreground">
                                点击节点或连线进行编辑；router 出边可设置
                                condition。
                            </p>
                        )}
                    </aside>
                )}
            </div>
        </div>
    );
}
