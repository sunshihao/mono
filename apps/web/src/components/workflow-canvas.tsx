"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { NODE_TYPES, TYPE_META } from "@/lib/node-meta";
import { Badge, Button, Input, Option, Select } from "@/components/ui";

/**
 * 画布例外说明：画布本体/节点/连线（@xyflow/react 的 ReactFlow/Background/Controls、
 * 节点 className 与 TYPE_META 色板）为画布专用直写样式，不走 MTW；
 * 周围工具区（toolbar/属性面板/引用下拉）走 @/components/ui 收拢层（内部 MTW）。
 */

// 节点类型元数据见 @/lib/node-meta（画布/设置页图例/执行轨迹共用一份）。
// 这里 re-export 仅为保持既有 import 路径可用。
export { NODE_TYPES, TYPE_META } from "@/lib/node-meta";

interface FlowNodeData extends Record<string, unknown> {
    label: string;
    nodeType: WorkflowNodeType;
    /** 节点配置往返（skill/mcp 的 config.refId 等）；画布编辑不覆盖原值 */
    config?: Record<string, unknown>;
}

type FlowNode = Node<FlowNodeData>;

/** 校验 config._pos 是否为合法坐标（避免脏数据破坏画布） */
function readPos(
    config?: Record<string, unknown>,
): { x: number; y: number } | null {
    const pos = config?._pos;
    if (
        pos &&
        typeof pos === "object" &&
        typeof (pos as { x: unknown }).x === "number" &&
        typeof (pos as { y: unknown }).y === "number"
    ) {
        return { x: (pos as { x: number }).x, y: (pos as { y: number }).y };
    }
    return null;
}

/** skill/mcp 节点的引用配置下拉数据源 */
interface RefOption {
    kind: "skill" | "mcp";
    id: string;
    name: string;
    description: string | null;
}

/**
 * WorkflowGraph ↔ React Flow 互转。位置：优先取节点保存过的拖动位置
 * （config._pos，拖动结束时写入并随图持久化），否则自动网格排布。
 */
function graphToFlow(graph: WorkflowGraph): {
    nodes: FlowNode[];
    edges: Edge[];
} {
    const nodes: FlowNode[] = graph.nodes.map((n, i) => ({
        id: n.id,
        position:
            readPos(n.config) ??
            ({ x: (i % 3) * 240, y: Math.floor(i / 3) * 140 } as const),
        data: {
            label: n.label ?? TYPE_META[n.type].label,
            nodeType: n.type,
            config: n.config,
        },
        className: cn(
            "rounded-md border-2 px-3 py-2 text-sm font-medium shadow-sm ",
            TYPE_META[n.type].className,
            "text-black",
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
            // 保留节点 config（含 skill/mcp 的 refId）——历史 bug：此前无条件重置为 {}
            config: n.data.config ?? {},
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
 *  - 编辑：添加 7 类节点（start/llm/retrieve/router/skill/mcp/end）、拖拽、
 *    连线（router 出边可设 condition）、删除、重命名
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
    // 新增 id 全局单调递增（不随外部 graph 重置，避免与已有节点 id 冲突）
    const [idCounter, setIdCounter] = useState(
        graph.nodes.length + graph.edges.length,
    );
    // 最近一次同步到父级的 graph：props.graph 与之不同 → 外部加载/版本切换，
    // 需要重建画布；相同 → 是我们自己 emit 的结果，保留内部状态（含拖动位置）
    const lastEmittedRef = useRef(graph);

    const emit = useCallback(
        (nextNodes: FlowNode[], nextEdges: Edge[]) => {
            const converted = flowToGraph(nextNodes, nextEdges);
            lastEmittedRef.current = converted;
            onChange?.(converted);
        },
        [onChange],
    );

    // 外部 graph 变化（首次加载/查看历史版本）时重建画布；
    // 自身 emit 的回流（graph === lastEmittedRef）不做处理
    useEffect(() => {
        if (graph === lastEmittedRef.current) return;
        lastEmittedRef.current = graph;
        const { nodes: ns, edges: es } = graphToFlow(graph);
        setNodes(ns);
        setEdges(es);
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
    }, [graph]);

    /**
     * 拖动（position change）高频触发：只本地更新 state 让 React Flow 跟随，
     * 不同步父级（避免拖动中每帧触发父组件全树重渲染导致拖拽卡顿/回弹）；
     * 拖动结束由 onNodeDragStop 统一落位并 emit。
     */
    const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
        setNodes((prev) => applyNodeChanges(changes, prev) as FlowNode[]);
    }, []);

    const onEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => {
        // 选中/拖动边不改变图结构，无需 emit（结构变化走 setEdgeCondition 等）
        setEdges((prev) => applyEdgeChanges(changes, prev));
    }, []);

    /** 拖动结束：把最终位置写入 config._pos（随图持久化，重开后保持） */
    const onNodeDragStop = useCallback(
        (_: unknown, node: FlowNode) => {
            setNodes((prev) => {
                const next = prev.map((n) =>
                    n.id === node.id
                        ? {
                              ...n,
                              data: {
                                  ...n.data,
                                  config: {
                                      ...(n.data.config ?? {}),
                                      _pos: {
                                          x: n.position.x,
                                          y: n.position.y,
                                      },
                                  },
                              },
                          }
                        : n,
                );
                emit(next, edges);
                return next;
            });
        },
        [edges, emit],
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
            data: {
                label: meta.label,
                nodeType: type,
                // 各类节点的默认配置：
                // 引用型（skill/mcp）待属性面板选 refId；retrieve 预置默认 topK（编译器读它）
                config:
                    type === "skill" || type === "mcp"
                        ? { refId: "" }
                        : type === "retrieve"
                          ? { topK: 5 }
                          : undefined,
            },
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

    // 引用型节点（skill/mcp）的可选配置：设置页注册的已启用项
    const [refOptions, setRefOptions] = useState<RefOption[]>([]);
    const [refError, setRefError] = useState<string | null>(null);
    useEffect(() => {
        let cancelled = false;
        async function load() {
            try {
                const [skRes, mcpRes] = await Promise.all([
                    api.v1.skills.$get(),
                    api.v1["mcp-tools"].$get(),
                ]);
                if (cancelled) return;
                const options: RefOption[] = [];
                if (skRes.ok) {
                    const body = await skRes.json();
                    options.push(
                        ...body.skills
                            .filter((s) => s.enabled)
                            .map((s) => ({
                                kind: "skill" as const,
                                id: s.id,
                                name: s.name,
                                description: s.description,
                            })),
                    );
                }
                if (mcpRes.ok) {
                    const body = await mcpRes.json();
                    options.push(
                        ...body.tools
                            .filter((t) => t.enabled)
                            .map((t) => ({
                                kind: "mcp" as const,
                                id: t.id,
                                name: t.name,
                                description: t.description,
                            })),
                    );
                }
                setRefOptions(options);
                if (!skRes.ok || !mcpRes.ok) {
                    setRefError("部分配置列表加载失败（服务端可能未就绪）");
                }
            } catch {
                if (!cancelled) setRefError("配置列表加载失败");
            }
        }
        void load();
        return () => {
            cancelled = true;
        };
    }, []);

    /** 节点下拉选择引用配置（写 config.refId；默认名未改名时同步为配置名） */
    const setNodeRef = (refId: string) => {
        if (!selectedNodeId) return;
        setNodes((prev) => {
            const next = prev.map((n) => {
                if (n.id !== selectedNodeId) return n;
                const meta = TYPE_META[n.data.nodeType];
                const picked = refOptions.find((o) => o.id === refId);
                return {
                    ...n,
                    data: {
                        ...n.data,
                        config: { ...(n.data.config ?? {}), refId },
                        ...(picked && n.data.label === meta.label
                            ? { label: picked.name }
                            : {}),
                    },
                };
            });
            emit(next, edges);
            return next;
        });
    };

    /**
     * 写选中节点的单个 config 字段（retrieve 的 topK/skillId/mcpToolId 等）。
     * 展开既有 config：`_pos`（拖拽坐标）与其余键必须原样保留。
     * 值为 undefined 时删除该键（下拉清空 → 不能留 ""，uuid 校验会挡下）。
     */
    const setNodeConfigField = (key: string, value: unknown) => {
        if (!selectedNodeId) return;
        setNodes((prev) => {
            const next = prev.map((n) => {
                if (n.id !== selectedNodeId) return n;
                const config = { ...(n.data.config ?? {}) };
                if (value === undefined) delete config[key];
                else config[key] = value;
                return { ...n, data: { ...n.data, config } };
            });
            emit(next, edges);
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
                    className="h-[520px] rounded-lg border border-base-300 bg-background"
                    style={{ height }}
                >
                    <ReactFlow<FlowNode, Edge>
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onNodeDragStop={onNodeDragStop}
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
                    <aside className="space-y-4 rounded-lg border border-base-300 p-4 text-sm">
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
                                {(selectedNode.data.nodeType === "skill" ||
                                    selectedNode.data.nodeType === "mcp") && (
                                    <RefSelect
                                        nodeType={selectedNode.data.nodeType}
                                        options={refOptions}
                                        error={refError}
                                        value={String(
                                            selectedNode.data.config?.refId ??
                                                "",
                                        )}
                                        onChange={setNodeRef}
                                    />
                                )}
                                {selectedNode.data.nodeType === "retrieve" && (
                                    <RetrieveConfig
                                        // key：换节点时重挂载，丢掉残留的输入框草稿
                                        key={selectedNode.id}
                                        config={selectedNode.data.config ?? {}}
                                        options={refOptions}
                                        error={refError}
                                        onChange={setNodeConfigField}
                                    />
                                )}
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

/**
 * retrieve 节点属性面板：检索参数（config.topK/skillId/mcpToolId）。
 *
 * 三个字段即知识库 tab 问答面板可调的那几项，编译器在 executeNode 的 retrieve 分支读取。
 * 附加技能/工具是可选的，故清空要写回 undefined 而不是 ""（uuid 校验会挡下空串）。
 */
function RetrieveConfig({
    config,
    options,
    error,
    onChange,
}: {
    config: Record<string, unknown>;
    options: RefOption[];
    error: string | null;
    onChange: (key: string, value: unknown) => void;
}) {
    // 输入框保留原始文本（允许中途清空/键入），只在解析出合法整数时写回 config；
    // 失焦时清掉草稿，非法输入便视觉回退到已提交值。父级以 node id 作 key，换节点即重置。
    const [draft, setDraft] = useState<string | null>(null);
    const committed = typeof config.topK === "number" ? config.topK : 5;
    const skillId = typeof config.skillId === "string" ? config.skillId : "";
    const mcpToolId =
        typeof config.mcpToolId === "string" ? config.mcpToolId : "";

    return (
        <div className="space-y-2">
            <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">
                    topK（召回条数，1–50）
                </span>
                <Input
                    type="number"
                    min={1}
                    max={50}
                    value={draft ?? String(committed)}
                    onChange={(e) => {
                        const raw = e.target.value;
                        setDraft(raw);
                        const n = Number(raw);
                        if (
                            raw !== "" &&
                            Number.isInteger(n) &&
                            n >= 1 &&
                            n <= 50
                        ) {
                            onChange("topK", n);
                        }
                    }}
                    onBlur={() => setDraft(null)}
                />
            </label>
            <Select
                label="附加技能（可选）"
                value={skillId}
                onChange={(v) => onChange("skillId", v || undefined)}
                containerClassName="w-full"
                className="w-full text-sm"
            >
                <Option value="">不附加</Option>
                {options
                    .filter((o) => o.kind === "skill")
                    .map((o) => (
                        <Option key={o.id} value={o.id}>
                            {o.name}
                        </Option>
                    ))}
            </Select>
            <Select
                label="附加工具（可选）"
                value={mcpToolId}
                onChange={(v) => onChange("mcpToolId", v || undefined)}
                containerClassName="w-full"
                className="w-full text-sm"
            >
                <Option value="">不附加</Option>
                {options
                    .filter((o) => o.kind === "mcp")
                    .map((o) => (
                        <Option key={o.id} value={o.id}>
                            {o.name}
                        </Option>
                    ))}
            </Select>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <p className="text-xs text-muted-foreground">
                走知识库检索管线：附加技能以 system
                指令并入合成，附加工具返回并入上下文。
            </p>
        </div>
    );
}

/** skill/mcp 节点属性面板：选择设置页已注册的引用配置（config.refId） */
function RefSelect({
    nodeType,
    options,
    error,
    value,
    onChange,
}: {
    nodeType: "skill" | "mcp";
    options: RefOption[];
    error: string | null;
    value: string;
    onChange: (refId: string) => void;
}) {
    const kindOptions = options.filter((o) => o.kind === nodeType);
    const kindLabel = nodeType === "skill" ? "技能" : "MCP 工具";
    return (
        <div className="space-y-1">
            <Select
                label={`引用${kindLabel}`}
                value={value}
                onChange={(v) => onChange(v ?? "")}
                className="w-full text-sm"
                containerClassName="w-full"
            >
                <Option value="">
                    {kindOptions.length === 0
                        ? "未配置（先在设置页添加）"
                        : "未选择"}
                </Option>
                {kindOptions.map((o) => (
                    <Option key={o.id} value={o.id}>
                        {o.name}
                        {o.description ? ` — ${o.description}` : ""}
                    </Option>
                ))}
            </Select>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <p className="text-xs text-muted-foreground">
                {nodeType === "skill"
                    ? "执行时以提示词技能注入 LLM"
                    : "执行时调用注册的 HTTP 端点（{query} 替换为问题）"}
            </p>
        </div>
    );
}
