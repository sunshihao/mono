"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Input —— daisyUI `input` 的收拢封装。
 *
 * daisyUI v5 的 `input` 自带描边与聚焦态，颜色随主题（data-theme）；
 * 默认 w-full 占满容器（旧 MTW 封装同为整宽，调用方按此布局）。
 *
 * label 渲染为字段上方的可见标签；不传 label 时只输出裸 <input>
 * （login-form 等用外部 <label htmlFor> 的场景照旧）。
 */
export interface InputProps extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "size"
> {
    label?: string;
}

export function Input({ className, label, id, ...props }: InputProps) {
    const field = (
        <input id={id} className={cn("input w-full", className)} {...props} />
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
