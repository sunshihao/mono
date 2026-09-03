"use client";

import * as React from "react";
import {
    Menu as MTMenu,
    MenuHandler as MTMenuHandler,
    MenuList as MTMenuList,
    MenuItem as MTMenuItem,
} from "@material-tailwind/react";
import { cn } from "@/lib/cn";

/**
 * Menu —— MTW Menu/MenuHandler/MenuList/MenuItem 的收拢封装。
 * 注意：MTW MenuHandler 会向子元素注入 ref/onClick（子元素须能承载 props，
 * 通常配 Button 或 button/div 元素），打开方式为点击（MTW 无官方 hover 菜单）。
 *
 * 用法：
 *   <Menu placement="bottom-end">
 *     <MenuHandler><button>触发</button></MenuHandler>
 *     <MenuList className="..."><MenuItem onClick={...}>选项</MenuItem></MenuList>
 *   </Menu>
 */

/** MTW d.ts 的 DOM props 快照差异（见 button.tsx 注释）在收拢边界放宽 */
type MTMenuLike = React.FC<{
    placement?: string;
    open?: boolean;
    handler?: (v: boolean) => void;
    offset?: number | Record<string, number>;
    children?: React.ReactNode;
}>;
const MtMenu = MTMenu as unknown as MTMenuLike;

type MTMenuHandlerLike = React.FC<{
    children: React.ReactElement;
}>;
const MtMenuHandler = MTMenuHandler as unknown as MTMenuHandlerLike;

type MTMenuListLike = React.FC<{
    className?: string;
    dismissible?: boolean;
    children?: React.ReactNode;
}>;
const MtMenuList = MTMenuList as unknown as MTMenuListLike;

type MTMenuItemLike = React.FC<{
    className?: string;
    disabled?: boolean;
    onClick?: React.MouseEventHandler<HTMLElement>;
    children?: React.ReactNode;
}>;
const MtMenuItem = MTMenuItem as unknown as MTMenuItemLike;

export function Menu({
    placement = "bottom-start",
    open,
    handler,
    children,
}: {
    placement?: string;
    open?: boolean;
    handler?: (v: boolean) => void;
    children?: React.ReactNode;
}) {
    return (
        <MtMenu placement={placement} open={open} handler={handler}>
            {children}
        </MtMenu>
    );
}

export function MenuHandler({ children }: { children: React.ReactElement }) {
    return <MtMenuHandler>{children}</MtMenuHandler>;
}

export function MenuList({
    className,
    children,
}: {
    className?: string;
    children?: React.ReactNode;
}) {
    return (
        <MtMenuList
            className={cn(
                "border border-border bg-card p-1 text-sm shadow-md",
                className,
            )}
        >
            {children}
        </MtMenuList>
    );
}

/** MenuItem —— 统一收敛默认字色/底色（MTW 默认 text 为 blue-gray-900） */
export function MenuItem({
    className,
    onClick,
    children,
}: {
    className?: string;
    disabled?: boolean;
    onClick?: React.MouseEventHandler<HTMLElement>;
    children?: React.ReactNode;
}) {
    return (
        <MtMenuItem
            onClick={onClick}
            className={cn(
                "px-3 py-2 text-sm text-foreground hover:bg-accent hover:text-foreground focus:bg-accent",
                className,
            )}
        >
            {children}
        </MtMenuItem>
    );
}
