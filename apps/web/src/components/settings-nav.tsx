"use client";

import { useState, type ReactNode } from "react";
import { TabBar } from "@/components/ui";

type SectionKey = "skills" | "mcpTools" | "elements" | "about";

const SECTIONS: { key: SectionKey; label: string }[] = [
    { key: "skills", label: "技能" },
    { key: "mcpTools", label: "MCP 工具" },
    { key: "elements", label: "工作流元素库" },
    { key: "about", label: "关于" },
];

/**
 * 设置页双栏骨架：左侧竖向导航（ui/TabBar orientation="vertical"，MTW Tabs 实现），右侧渲染对应内容。
 * 各面板全部渲染、非激活项仅 hidden —— 切走再切回不丢表单状态
 * （MTW TabPanel 会卸载非激活面板故不用）。内容由 server 渲染后传入。
 */
export function SettingsNav({
    skills,
    mcpTools,
    elements,
    about,
}: {
    skills: ReactNode;
    mcpTools: ReactNode;
    elements: ReactNode;
    about: ReactNode;
}) {
    const [active, setActive] = useState<SectionKey>("skills");
    const panes: { key: SectionKey; node: ReactNode }[] = [
        { key: "skills", node: skills },
        { key: "mcpTools", node: mcpTools },
        { key: "elements", node: elements },
        { key: "about", node: about },
    ];

    return (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
            <div className="w-full shrink-0 lg:w-44">
                <TabBar
                    orientation="vertical"
                    items={SECTIONS}
                    value={active}
                    onChange={(k) => setActive(k as SectionKey)}
                    className="w-full"
                />
            </div>
            <div className="min-w-0 flex-1 space-y-4">
                {panes.map(({ key, node }) => (
                    <section
                        key={key}
                        hidden={active !== key}
                        className={active !== key ? "hidden" : ""}
                    >
                        {node}
                    </section>
                ))}
            </div>
        </div>
    );
}
