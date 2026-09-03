"use client";

import * as React from "react";
import { Card as MTCard } from "@material-tailwind/react";
import { cn } from "@/lib/cn";

/**
 * Card —— @material-tailwind/react Card 的收拢封装（表面/边框/阴影由 MTW 提供，
 * 颜色收敛回 CSS 变量 token 随明暗主题）。其余分区组件为纯内容容器/排版
 * （与页面标题/正文同类例外），保持原生元素、不引 MTW。
 */

/** MTW d.ts 的 DOM props 快照差异（见 button.tsx 注释）在收拢边界放宽 */
type MTCardLike = React.FC<
    React.HTMLAttributes<HTMLDivElement> & {
        variant?: string;
        color?: string;
        shadow?: boolean;
    }
>;
const MtCard = MTCard as unknown as MTCardLike;

export function Card({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <MtCard
            variant="filled"
            shadow={false}
            className={cn(
                "rounded-lg border border-border bg-card text-card-foreground shadow-sm",
                className,
            )}
            {...props}
        />
    );
}

/** 内容分区（原生容器）：header/content/title/desc 为排版与布局，不走 MTW */
export function CardHeader({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            className={cn("flex flex-col space-y-1.5 p-6", className)}
            {...props}
        />
    );
}

export function CardTitle({
    className,
    ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
    return (
        <h3
            className={cn(
                "text-lg font-semibold leading-none tracking-tight",
                className,
            )}
            {...props}
        />
    );
}

export function CardDescription({
    className,
    ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
    return (
        <p
            className={cn("text-sm text-muted-foreground", className)}
            {...props}
        />
    );
}

export function CardContent({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) {
    return <div className={cn("p-6 pt-0", className)} {...props} />;
}
