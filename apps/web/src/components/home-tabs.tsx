"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type TabKey = "knowledge" | "workflows" | "settings";

const TABS: { key: TabKey; label: string }[] = [
    { key: "knowledge", label: "知识库问答" },
    { key: "workflows", label: "工作流" },
    { key: "settings", label: "设置" },
];

/**
 * 首页三段式 Tab：三个 pane 全部渲染、非激活项仅 hidden（保活各 pane 的
 * client 状态——聊天历史、输入值切换 tab 不丢失）。内容由 server 渲染后传入。
 */
export function HomeTabs({
    knowledge,
    workflows,
    settings,
}: {
    knowledge: ReactNode;
    workflows: ReactNode;
    settings: ReactNode;
}) {
    const [active, setActive] = useState<TabKey>("knowledge");
    const panes: { key: TabKey; node: ReactNode }[] = [
        { key: "knowledge", node: knowledge },
        { key: "workflows", node: workflows },
        { key: "settings", node: settings },
    ];

    return (
        <div className="space-y-6">
            <div
                role="tablist"
                aria-label="工作台分区"
                className="inline-flex items-center rounded-lg border bg-muted/50 p-1"
            >
                {TABS.map((tab) => (
                    <button
                        key={tab.key}
                        role="tab"
                        type="button"
                        aria-selected={active === tab.key}
                        onClick={() => setActive(tab.key)}
                        className={cn(
                            "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                            active === tab.key
                                ? "bg-card text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>
            {panes.map(({ key, node }) => (
                <section
                    key={key}
                    role="tabpanel"
                    hidden={active !== key}
                    className={cn("space-y-6", active !== key && "hidden")}
                >
                    {node}
                </section>
            ))}
        </div>
    );
}
