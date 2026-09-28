"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Badge —— 独立小圆签，daisyUI `badge` 的收拢封装。
 *
 * 默认走中性描边（badge-outline）；需要彩色时由调用方 className 覆盖
 * （Tailwind 工具类在 daisyUI 组件类之后生效，覆盖得动）。
 */
export function Badge({
    className,
    children,
}: {
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <span className={cn("badge badge-outline badge-sm", className)}>
            {children}
        </span>
    );
}
