"use client";

import { useState, type ReactNode } from "react";
import { TabBar } from "@/components/ui";

type TabKey = "knowledge" | "workflows" | "settings";

const TABS: { key: TabKey; label: string }[] = [
    { key: "knowledge", label: "知识库问答" },
    { key: "workflows", label: "工作流" },
    { key: "settings", label: "设置" },
];

/**
 * 首页三段式 Tab（按钮行 = ui/TabBar，MTW Tabs 实现）：
 * 三个 pane 全部渲染、非激活项仅 hidden（保活各 pane 的 client 状态——
 * 聊天历史、输入值切换 tab 不丢失；MTW TabPanel 会卸载非激活面板故不用）。
 * 内容由 server 渲染后传入。
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
            <div role="tablist" aria-label="工作台分区" className="w-fit">
                <TabBar
                    items={TABS}
                    value={active}
                    onChange={(k) => setActive(k as TabKey)}
                />
            </div>
            {panes.map(({ key, node }) => (
                <section
                    key={key}
                    role="tabpanel"
                    hidden={active !== key}
                    className={active !== key ? "hidden" : "space-y-6"}
                >
                    {node}
                </section>
            ))}
        </div>
    );
}
