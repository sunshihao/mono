"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Menu —— 下拉菜单收拢封装（面板外观/菜单项排版走 daisyUI 的 menu + 语义色 token）。
 *
 * 用法与迁移前一致：
 *   <Menu placement="bottom-end">
 *     <MenuHandler><button>触发</button></MenuHandler>
 *     <MenuList className="..."><MenuItem onClick={...}>选项</MenuItem></MenuList>
 *   </Menu>
 *
 * 与旧 MTW 实现的差异（对外 API 不变）：
 *   - MenuHandler 仍向子元素注入 onClick/aria（子元素需能透传 props，通常配 Button 或原生 button）；
 *   - 展开状态由本组件持有（受控时以 open/handler 为准），点击外部与 Esc 关闭；
 *   - 面板关闭时直接不渲染。
 *
 * 定位用的是普通 Tailwind 绝对定位而非 daisyUI 的 .dropdown：
 * .dropdown 靠 :focus-within 展开，与「受控 + 点击外部关闭」会互相打架
 * （点触发器即获得焦点，状态关了样式仍开着），故这里只借 daisyUI 的面板/菜单项视觉。
 */

interface MenuCtxValue {
    open: boolean;
    panelClass: string;
    toggle: () => void;
    close: () => void;
}

const MenuCtx = React.createContext<MenuCtxValue | null>(null);

/** placement（旧 MTW 取值）→ 面板定位类 */
const PLACEMENT: Record<string, string> = {
    "bottom-start": "left-0 top-full mt-2",
    "bottom-end": "right-0 top-full mt-2",
};

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
    const [uncontrolled, setUncontrolled] = React.useState(false);
    const rootRef = React.useRef<HTMLDivElement>(null);

    const controlled = open !== undefined;
    const isOpen = controlled ? !!open : uncontrolled;

    // handler 放 ref：避免调用方每次渲染传新函数导致 setOpen 抖动、effect 反复解绑
    const handlerRef = React.useRef(handler);
    handlerRef.current = handler;

    const setOpen = React.useCallback(
        (next: boolean) => {
            if (!controlled) setUncontrolled(next);
            handlerRef.current?.(next);
        },
        [controlled],
    );

    React.useEffect(() => {
        if (!isOpen) return;
        function onPointerDown(e: PointerEvent) {
            if (
                rootRef.current &&
                !rootRef.current.contains(e.target as Node)
            ) {
                setOpen(false);
            }
        }
        function onKeyDown(e: KeyboardEvent) {
            if (e.key === "Escape") setOpen(false);
        }
        document.addEventListener("pointerdown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [isOpen, setOpen]);

    const ctx = React.useMemo<MenuCtxValue>(
        () => ({
            open: isOpen,
            panelClass: PLACEMENT[placement] ?? PLACEMENT["bottom-start"],
            toggle: () => setOpen(!isOpen),
            close: () => setOpen(false),
        }),
        [isOpen, placement, setOpen],
    );

    return (
        <MenuCtx.Provider value={ctx}>
            <div ref={rootRef} className="relative inline-block">
                {children}
            </div>
        </MenuCtx.Provider>
    );
}

export function MenuHandler({ children }: { children: React.ReactElement }) {
    const ctx = React.useContext(MenuCtx);
    const child = children as React.ReactElement<{
        onClick?: React.MouseEventHandler<HTMLElement>;
        "aria-haspopup"?: string;
        "aria-expanded"?: boolean;
    }>;

    if (!ctx) return child;

    return React.cloneElement(child, {
        onClick: (e: React.MouseEvent<HTMLElement>) => {
            child.props.onClick?.(e);
            ctx.toggle();
        },
        "aria-haspopup": "menu",
        "aria-expanded": ctx.open,
    });
}

export function MenuList({
    className,
    children,
}: {
    className?: string;
    children?: React.ReactNode;
}) {
    const ctx = React.useContext(MenuCtx);
    if (!ctx?.open) return null;

    return (
        <div
            role="menu"
            className={cn(
                "menu absolute z-50 min-w-52 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg",
                ctx.panelClass,
                className,
            )}
        >
            {children}
        </div>
    );
}

/** MenuItem —— 菜单项（daisyUI menu 的项排版 + 语义色悬浮态） */
export function MenuItem({
    className,
    disabled,
    onClick,
    children,
}: {
    className?: string;
    disabled?: boolean;
    onClick?: React.MouseEventHandler<HTMLElement>;
    children?: React.ReactNode;
}) {
    const ctx = React.useContext(MenuCtx);

    return (
        <button
            type="button"
            role="menuitem"
            disabled={disabled}
            onClick={(e) => {
                onClick?.(e);
                ctx?.close();
            }}
            className={cn(
                "flex w-full items-center gap-2 rounded-field px-3 py-2 text-left text-sm text-base-content hover:bg-base-200 disabled:pointer-events-none disabled:opacity-50",
                className,
            )}
        >
            {children}
        </button>
    );
}
