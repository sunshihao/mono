"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * TabBar —— daisyUI `tabs` 的收拢封装：仅渲染分段标签按钮行。
 *
 * 保活说明：面板区由调用方自持（全部渲染 + hidden，见 home-tabs/settings-nav），
 * TabBar 只负责标签按钮行本身，不接管面板的挂载/卸载。
 *
 * orientation="vertical"（设置页左侧导航形态）：daisyUI 5 的 tabs 只有横向变体，
 * 这里用 flex-col 把同一套 tab 按钮竖排并左对齐。
 */
export interface TabItem {
    key: string;
    label: React.ReactNode;
}

export interface TabBarProps {
    items: TabItem[];
    value: string;
    onChange: (key: string) => void;
    /** 竖向排列（设置页左侧导航形态）；不传默认 horizontal */
    orientation?: "horizontal" | "vertical";
    className?: string;
}

export function TabBar({
    items,
    value,
    onChange,
    orientation,
    className,
}: TabBarProps) {
    const vertical = orientation === "vertical";
    return (
        <div
            role="tablist"
            className={cn(
                "tabs tabs-box w-full",
                // daisyUI 的 .tabs 用 flex-direction: var(--tabs-direction) 控方向，
                // 直接加 flex-col 会被它压掉，故按其机制改这个变量
                vertical && "[--tabs-direction:column]",
                className,
            )}
        >
            {items.map((it) => {
                const active = it.key === value;
                return (
                    <button
                        key={it.key}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => onChange(it.key)}
                        className={cn(
                            "tab",
                            active && "tab-active",
                            vertical && "justify-start",
                        )}
                    >
                        {it.label}
                    </button>
                );
            })}
        </div>
    );
}
