"use client";

import * as React from "react";
import { Spinner as MTSpinner } from "@material-tailwind/react";
import { cn } from "@/lib/cn";

/**
 * Spinner —— MTW Spinner 的收拢封装；默认颜色收敛回 muted token（随明暗主题），
 * 尺寸用 className 控制（如 h-4 w-4）。
 */

/** MTW d.ts 的 DOM props 快照差异（见 button.tsx 注释）在收拢边界放宽 */
const MtSpinner = MTSpinner as unknown as React.FC<{ className?: string }>;

export function Spinner({ className }: { className?: string }) {
    return (
        <MtSpinner className={cn("h-4 w-4 text-muted-foreground", className)} />
    );
}
