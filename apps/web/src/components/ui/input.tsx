"use client";

import * as React from "react";
import { Input as MTInput } from "@material-tailwind/react";
import { cn } from "@/lib/cn";

/**
 * Input —— @material-tailwind/react outlined Input 的收拢封装。
 *
 * 边框常态/placeholder-shown/focus 三态均收敛回 CSS 变量 token
 * （--input/--ring，随 .dark 明暗主题），placeholder 常态可见
 * （MTW outlined 默认仅聚焦时显示占位符）。
 *
 * 注意：MTW Input 内部总会渲染一个 floating label 骨架（label 为空串时不可见，
 * 聚焦/输入时顶部边框会有极小的 label 缺口段）——现有页面表单都是外部 label，
 * 不传 label 走空 label 分支即可。
 */

/** MTW d.ts 的 DOM props 快照差异（见 button.tsx 注释）在收拢边界放宽 */
type MTInputLike = React.FC<
    Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> & {
        variant?: string;
        size?: "md" | "lg";
        color?: string;
        label?: string;
        error?: boolean;
        success?: boolean;
        icon?: React.ReactNode;
        labelProps?: Record<string, unknown>;
        containerProps?: Record<string, unknown>;
        shrink?: boolean;
        inputRef?: React.Ref<HTMLInputElement>;
    }
>;
const MtInput = MTInput as unknown as MTInputLike;

export function Input({
    className,
    ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">) {
    return (
        <MtInput
            variant="outlined"
            size="md"
            className={cn(
                "h-9 rounded-md px-3 text-sm text-foreground",
                "border-input placeholder-shown:border-input focus:border-ring",
                "placeholder:text-muted-foreground placeholder:opacity-100",
                "bg-transparent disabled:bg-transparent",
                className,
            )}
            {...props}
        />
    );
}
