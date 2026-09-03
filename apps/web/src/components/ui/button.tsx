"use client";

import * as React from "react";
import { Button as MTButton } from "@material-tailwind/react";
import { cn } from "@/lib/cn";

/**
 * Button —— @material-tailwind/react Button 的收拢封装。
 *
 * 约定：components/ui 是 apps/web 唯一允许直接 import @material-tailwind/react
 * 的目录；页面/feature 组件一律经此出口使用 MTW 组件，后续全局换肤/换色只改这里。
 *
 * 语义 API 保持旧 shadcn 风格：variant default|outline|ghost
 * → MTW filled|outlined|text；默认颜色收敛回 CSS 变量 token（随 .dark 明暗主题），
 * MTW 自带的彩色/大写/大圆角视觉已在下方 className 中压平。
 */

/** MTW d.ts 的 DOM props 快照与当前 @types/react 存在缺位键差异（若干事件/属性键被
 *  视作必填），在收拢边界统一放宽为标准元素 props —— 对外仍由下方 ButtonProps 把关。 */
type MTButtonLike = React.FC<
    React.ButtonHTMLAttributes<HTMLButtonElement> & {
        variant?: string;
        size?: string;
        ripple?: boolean;
        loading?: boolean;
    }
>;
const Btn = MTButton as unknown as MTButtonLike;

const MTW_VARIANT = {
    default: "filled",
    outline: "outlined",
    ghost: "text",
} as const;

/** 视觉收敛（压 MTW 默认值：uppercase/font-bold/彩色底/大圆角 → 中性细边 token 观感） */
const variantClasses = {
    default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
    outline:
        "border-input bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground",
    ghost: "bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground",
};

const sizeClasses = {
    default: "h-9 px-4 py-2 text-sm",
    sm: "h-8 px-3 text-xs",
    lg: "h-10 px-8",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: keyof typeof MTW_VARIANT;
    size?: keyof typeof sizeClasses;
}

export function Button({
    className,
    variant = "default",
    size = "default",
    ...props
}: ButtonProps) {
    return (
        <Btn
            variant={MTW_VARIANT[variant]}
            size="md"
            ripple
            className={cn(
                // 压平 MTW 默认排版（大写/加粗）并恢复旧观感的圆角字号
                "rounded-md font-medium normal-case tracking-normal",
                "disabled:pointer-events-none disabled:opacity-50",
                variantClasses[variant],
                sizeClasses[size],
                className,
            )}
            {...props}
        />
    );
}
