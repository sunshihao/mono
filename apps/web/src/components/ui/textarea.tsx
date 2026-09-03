"use client";

import * as React from "react";
import { Textarea as MTTextarea } from "@material-tailwind/react";
import { cn } from "@/lib/cn";

/**
 * Textarea —— @material-tailwind/react outlined Textarea 的收拢封装
 * （三态边框/占位符收敛见 input.tsx 注释，同一套 token）。
 */

/** MTW d.ts 的 DOM props 快照差异（见 button.tsx 注释）在收拢边界放宽 */
type MTTextareaLike = React.FC<
    Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "size"> & {
        variant?: string;
        size?: "md" | "lg";
        color?: string;
        label?: string;
        error?: boolean;
        success?: boolean;
        resize?: boolean;
        icon?: React.ReactNode;
        labelProps?: Record<string, unknown>;
        containerProps?: Record<string, unknown>;
        shrink?: boolean;
        inputRef?: React.Ref<HTMLTextAreaElement>;
    }
>;
const MtTextarea = MTTextarea as unknown as MTTextareaLike;

export function Textarea({
    className,
    ...props
}: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "size">) {
    return (
        <MtTextarea
            variant="outlined"
            size="md"
            resize
            className={cn(
                "rounded-md px-3 text-sm text-foreground",
                "border-input placeholder-shown:border-input focus:border-ring",
                "placeholder:text-muted-foreground placeholder:opacity-100",
                "bg-transparent disabled:bg-transparent",
                className,
            )}
            {...props}
        />
    );
}
