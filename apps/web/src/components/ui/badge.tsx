"use client";

import * as React from "react";
import { Chip } from "@material-tailwind/react";
import { cn } from "@/lib/cn";

/**
 * Badge —— 独立小圆签（旧 shadcn Badge 语义）。
 *
 * @material-tailwind/react 的 Badge 是"挂角通知点"（必须包在子元素上），语义不符，
 * 故用 MTW Chip 实现独立小签。默认中性描边样式收敛回 CSS 变量 token；
 * 需要彩色时由调用方 className 覆盖（twMerge 后写优先），
 * 或在后续需要时升级为语义 tone prop（集中色板映射，方便全局换色）。
 */
export function Badge({
    className,
    children,
}: {
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <Chip
            variant="filled"
            color="gray"
            size="md"
            className={cn(
                "inline-flex items-center rounded-full border bg-transparent px-2.5 py-0.5",
                "text-xs font-semibold normal-case tracking-normal text-foreground",
                "transition-colors",
                className,
            )}
            value={children}
        />
    );
}
