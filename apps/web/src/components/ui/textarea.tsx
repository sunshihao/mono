"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Textarea —— daisyUI `textarea` 的收拢封装（描边/聚焦态同 input，随主题）。
 * label 语义与 input.tsx 一致：传了就在上方渲染可见标签。
 */
export interface TextareaProps extends Omit<
    React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    "size"
> {
    label?: string;
}

export function Textarea({ className, label, id, ...props }: TextareaProps) {
    const field = (
        <textarea
            id={id}
            className={cn("textarea w-full", className)}
            {...props}
        />
    );

    if (!label) return field;

    return (
        <label className="block w-full">
            <span className="label w-full justify-start px-0 pb-1 text-xs text-muted-foreground">
                {label}
            </span>
            {field}
        </label>
    );
}
