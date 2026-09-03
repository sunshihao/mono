"use client";

import * as React from "react";
import {
    Select as MTSelect,
    Option as MTOption,
} from "@material-tailwind/react";
import { cn } from "@/lib/cn";

/**
 * Select —— @material-tailwind/react Select（受控 value/onChange）+ Option 的收拢封装。
 * 用法：
 *   <Select label="技能" value={v} onChange={setV}>
 *     <Option value="">不使用</Option>
 *     <Option value={o.id}>{o.name}</Option>
 *   </Select>
 * className 落在触发区域（label/字段）上；外层容器宽度默认 w-full（配 containerClassName
 * "w-auto min-w-0" 等收敛为内容宽度，便于放进工具行）。
 */

/** MTW d.ts 的 DOM props 快照差异（见 button.tsx 注释）在收拢边界放宽 */
type MTSelectLike = React.FC<{
    label?: string;
    value?: string;
    onChange?: (value?: string) => void;
    disabled?: boolean;
    error?: boolean;
    variant?: string;
    size?: "md" | "lg";
    color?: string;
    className?: string;
    containerProps?: { className?: string };
    children?: React.ReactNode;
}>;
const MtSelect = MTSelect as unknown as MTSelectLike;

type MTOptionLike = React.FC<{
    value?: string;
    className?: string;
    children?: React.ReactNode;
}>;
const MtOption = MTOption as unknown as MTOptionLike;

export interface SelectProps {
    label?: string;
    value?: string;
    onChange?: (value?: string) => void;
    disabled?: boolean;
    error?: boolean;
    className?: string;
    /** 传给外层容器 div（默认 w-full，传 "w-auto max-w-44" 等收敛为内容宽度） */
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
    return (
        <MtSelect
            label={label}
            value={value}
            onChange={onChange}
            disabled={disabled}
            error={error}
            variant="outlined"
            size="md"
            containerProps={
                containerClassName
                    ? { className: containerClassName }
                    : undefined
            }
            className={cn("h-9 text-sm text-foreground", className)}
        >
            {children}
        </MtSelect>
    );
}

/** Option —— MTW SelectOption 的收拢别名 */
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
        <MtOption value={value} className={className}>
            {children}
        </MtOption>
    );
}
