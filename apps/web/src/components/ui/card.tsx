"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Card —— daisyUI `card` 的收拢封装（圆角/表面色走 daisyUI 主题变量）。
 *
 * 分区组件（Header/Content/Title/Description）保持原生容器与既有内边距：
 * 调用方是按「p-6 上下分区」的旧 shadcn 布局写的，换成 card-body 会改变各页留白，
 * 故这里只把表面/描边/圆角切到 daisyUI token，布局语义不动。
 */
export function Card({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            className={cn(
                "card border border-base-300 bg-base-100 text-base-content",
                className,
            )}
            {...props}
        />
    );
}

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
