"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Spinner —— daisyUI `loading loading-spinner` 的收拢封装；
 * 尺寸用 className 控制（如 loading-sm / loading-xs）。
 */
export function Spinner({ className }: { className?: string }) {
    return (
        <span
            className={cn("loading loading-spinner loading-sm", className)}
            role="status"
            aria-label="加载中"
        />
    );
}
