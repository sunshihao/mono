"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Button —— daisyUI `btn` 的收拢封装。
 *
 * 约定：components/ui 是 apps/web 的 UI 收拢层，页面/feature 组件一律经此出口取组件，
 * 不直接拼 daisyUI 的组件类名（后续全局换肤/换色只改本目录）。
 *
 * 语义 API 沿用旧 shadcn 风格：variant default|outline|ghost、size default|sm|lg，
 * 映射到 daisyUI 的 btn-primary / btn-outline / btn-ghost 与 btn-md / btn-sm / btn-lg。
 *
 * forwardRef：daisyUI 的 dropdown 等组合场景需要 ref 落到实际 button 上，
 * 故本包装继续转发 ref（对外签名与迁移前一致，调用方无需改动）。
 */

const VARIANT = {
    default: "btn-primary",
    outline: "btn-outline",
    ghost: "btn-ghost",
} as const;

const SIZE = {
    default: "btn-md",
    sm: "btn-sm",
    lg: "btn-lg",
} as const;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: keyof typeof VARIANT;
    size?: keyof typeof SIZE;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    function Button(
        { className, variant = "default", size = "default", type, ...props },
        ref,
    ) {
        return (
            <button
                ref={ref}
                // 默认 type="button"：避免嵌在表单里的按钮意外触发 submit
                type={type ?? "button"}
                className={cn("btn", VARIANT[variant], SIZE[size], className)}
                {...props}
            />
        );
    },
);
