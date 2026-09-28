"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Select —— daisyUI `select` 的收拢封装（原生 <select>）。
 *
 * 用法（与迁移前一致）：
 *   <Select label="技能" value={v} onChange={setV}>
 *     <Option value="">不使用</Option>
 *     <Option value={o.id}>{o.name}</Option>
 *   </Select>
 *
 * onChange 回调签名保持 (value?: string) => void —— 内部包一层从事件里取值，
 * 调用方无需感知原生事件（既有调用点全部按此签名书写）。
 *
 * label 现在渲染为字段上方的可见标签（daisyUI 的 label 排版）；
 * 旧 MTW 实现是字段内浮动标签，改为上方后与同排的 Input 高度一致，
 * mcp-tool-manager 里「Select + Input 并排」的布局不受影响。
 */
export interface SelectProps {
    label?: string;
    value?: string;
    onChange?: (value?: string) => void;
    disabled?: boolean;
    error?: boolean;
    className?: string;
    /** 外层容器宽度控制（默认 w-full；传 "w-auto min-w-0" 收敛为内容宽度） */
    containerClassName?: string;
    children?: React.ReactNode;
}

export function Select({
    label,
    value,
    onChange,
    disabled,
    error,
    className,
    containerClassName,
    children,
}: SelectProps) {
    const field = (
        <select
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            disabled={disabled}
            className={cn("select w-full", error && "select-error", className)}
        >
            {children}
        </select>
    );

    if (!label) {
        return <div className={cn("w-full", containerClassName)}>{field}</div>;
    }

    return (
        <div className={cn("w-full", containerClassName)}>
            <span className="label w-full justify-start px-0 pb-1 text-xs text-muted-foreground">
                {label}
            </span>
            {field}
        </div>
    );
}

/** Option —— 原生 <option>（保持既有 <Option value=...>子节点</Option> 写法） */
export function Option({
    value,
    className,
    children,
}: {
    value?: string;
    className?: string;
    children?: React.ReactNode;
}) {
    return (
        <option value={value} className={className}>
            {children}
        </option>
    );
}
