"use client";

import * as React from "react";
import {
    Tabs as MTTabs,
    TabsHeader as MTTabsHeader,
    Tab as MTTab,
} from "@material-tailwind/react";
import { cn } from "@/lib/cn";

/**
 * TabBar —— MTW Tabs/TabsHeader/Tab 的收拢封装：仅渲染分段标签按钮行。
 *
 * 保活说明：MTW 的 TabsBody/TabPanel 会卸载非激活面板（聊天历史/表单状态丢失），
 * 因此面板区由调用方自持（全部渲染 + hidden，见 home-tabs/settings-nav），
 * TabBar 只借 MTW 的 Tabs 上下文与 Tab 按钮结构。
 *
 * 激活态样式：MTW Tab 的 className 恒最后合并（会压掉 activeClassName 状态类），
 * 故在 TabBar 内按 active 值直接给出完整激活/非激活 className；
 * MTW 自带滑动 indicator 视觉与"分段白底"观感冲突，经 indicatorProps 隐藏。
 */

/** MTW d.ts 的 DOM props 快照差异（见 button.tsx 注释）在收拢边界放宽 */
type MTTabsLike = React.FC<{
    value?: string | number;
    className?: string;
    orientation?: "horizontal" | "vertical";
    children?: React.ReactNode;
}>;
const TabsComp = MTTabs as unknown as MTTabsLike;

type MTTabsHeaderLike = React.FC<{
    className?: string;
    indicatorProps?: { className?: string };
    children?: React.ReactNode;
}>;
const TabsHeaderComp = MTTabsHeader as unknown as MTTabsHeaderLike;

type MTTabLike = React.FC<{
    value?: string | number;
    className?: string;
    disabled?: boolean;
    "aria-selected"?: boolean;
    onClick?: React.MouseEventHandler<HTMLElement>;
    children?: React.ReactNode;
}>;
const TabComp = MTTab as unknown as MTTabLike;

export interface TabItem {
    key: string;
    label: React.ReactNode;
}

export interface TabBarProps {
    items: TabItem[];
    value: string;
    onChange: (key: string) => void;
    /** 竖向排列（设置页左侧导航形态） */
    vertical?: boolean;
    className?: string;
}

const tabBase = "rounded-md px-4 py-1.5 text-sm font-medium transition-colors";
const tabInactive = "text-muted-foreground hover:text-foreground";
const tabActive = "bg-card text-foreground shadow-sm";

export function TabBar({
    items,
    value,
    onChange,
    vertical,
    className,
}: TabBarProps) {
    return (
        <TabsComp value={value} className="w-full inline-flex overflow-visible">
            <TabsHeaderComp
                indicatorProps={{ className: "hidden" }}
                className={cn(
                    "w-full inline-flex gap-1 rounded-lg border border-border bg-muted/50 p-1",
                    vertical && "flex-col",
                    className,
                )}
            >
                {items.map((it) => {
                    const active = it.key === value;
                    return (
                        <TabComp
                            key={it.key}
                            value={it.key}
                            aria-selected={active}
                            onClick={() => onChange(it.key)}
                            className={cn(
                                tabBase,
                                "w-auto",
                                active ? tabActive : tabInactive,
                            )}
                        >
                            {it.label}
                        </TabComp>
                    );
                })}
            </TabsHeaderComp>
        </TabsComp>
    );
}
