"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type SectionKey = "skills" | "mcpTools" | "elements" | "about";

const SECTIONS: { key: SectionKey; label: string }[] = [
    { key: "skills", label: "技能" },
    { key: "mcpTools", label: "MCP 工具" },
    { key: "elements", label: "工作流元素库" },
    { key: "about", label: "关于" },
];

/**
 * 设置页双栏骨架：左侧导航（点击切换），右侧渲染对应内容。
 * 各面板全部渲染、非激活项仅 hidden —— 切走再切回不丢表单状态。
 * 内容由 server 渲染后传入（与 HomeTabs 同思路）。
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
            <nav
                aria-label="设置分类"
                className="w-full shrink-0 space-y-1 rounded-lg border p-2 lg:w-44"
            >
                {SECTIONS.map((s) => (
                    <button
                        key={s.key}
                        type="button"
                        aria-selected={active === s.key}
                        onClick={() => setActive(s.key)}
                        className={cn(
                            "w-full rounded-md px-3 py-2 text-left text-sm font-medium transition-colors",
                            active === s.key
                                ? "bg-accent text-accent-foreground"
                                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                        )}
                    >
                        {s.label}
                    </button>
                ))}
            </nav>
            <div className="min-w-0 flex-1 space-y-4">
                {panes.map(({ key, node }) => (
                    <section
                        key={key}
                        hidden={active !== key}
                        className={cn(active !== key && "hidden")}
                    >
                        {node}
                    </section>
                ))}
            </div>
        </div>
    );
}
