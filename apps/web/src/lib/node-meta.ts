import type { WorkflowNodeType } from "@repo/types";

/**
 * 节点类型元数据 —— 唯一事实源。
 *
 * 从 workflow-canvas.tsx 抽出：原先画布的 TYPE_META 与 settings-panel.tsx 的
 * NODE_ELEMENTS 是两份手工维护的清单，后者不参与编译期校验、已经漂移。
 * 现在由画布、设置页图例、运行面板的执行轨迹共用同一份。
 *
 * TYPE_META 是 Record<WorkflowNodeType, …>：枚举新增类型而这里漏项会直接编译报错，
 * 这正是它比手工图例可靠的地方。
 */
export const NODE_TYPES: WorkflowNodeType[] = [
    "start",
    "llm",
    "retrieve",
    "router",
    "skill",
    "mcp",
    "end",
];

export interface NodeTypeMeta {
    /** 中文名（画布节点默认标签、图例、执行轨迹共用） */
    label: string;
    /** 画布节点配色（画布专用直写样式，不走 @/components/ui） */
    className: string;
}

export const TYPE_META: Record<WorkflowNodeType, NodeTypeMeta> = {
    start: {
        label: "开始",
        className: "border-emerald-500 bg-emerald-50 dark:bg-emerald-950",
    },
    llm: {
        label: "LLM",
        className: "border-violet-500 bg-violet-50 dark:bg-violet-950",
    },
    retrieve: {
        label: "检索",
        className: "border-sky-500 bg-sky-50 dark:bg-sky-950",
    },
    router: {
        label: "路由",
        className: "border-amber-500 bg-amber-50 dark:bg-amber-950",
    },
    skill: {
        label: "技能",
        className: "border-teal-500 bg-teal-50 dark:bg-teal-950",
    },
    mcp: {
        label: "MCP",
        className: "border-fuchsia-500 bg-fuchsia-50 dark:bg-fuchsia-950",
    },
    end: {
        label: "结束",
        className: "border-rose-500 bg-rose-50 dark:bg-rose-950",
    },
};

/** 直通节点：执行时不做任何事（编译器里 start/router/end 返回空更新） */
export function isPassthrough(type: WorkflowNodeType): boolean {
    return type === "start" || type === "router" || type === "end";
}
