"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Dialog —— daisyUI 5 `modal` / `modal-box` / `modal-action` 的收拢封装（确认弹窗）。
 *
 * 映射：Dialog → .modal.modal-open（视口级遮罩 + 居中栅格）、
 *       DialogTitle → 框内标题、DialogActions → .modal-action（右下按钮行）。
 * 宽度/内边距沿用 daisyUI 默认（.modal-box 宽 91.67% / max-w-32rem / p-6）。
 *
 * 受控封装：本组件不持有展开状态（它没有触发器，自己持有状态也无从打开），
 * 由调用方用 open + onOpenChange 驱动 —— 用法见 components/delete-workflow-button.tsx。
 * 这点与 ui/menu.tsx 的 MenuHandler 不同：菜单要装饰调用方给的任意触发器，
 * 而弹窗的确认/取消按钮就在框内、其 disabled 与文案本就依赖调用方状态，
 * 故这里不做 trigger prop（省不下行数，还得 cloneElement 合 props）。
 *
 * 交互按 ui/menu.tsx 的手写路子（不依赖 daisyUI 的 :target / 原生 <dialog>）：
 *   - Escape 关闭（document keydown）；
 *   - 点击遮罩关闭：.modal 自身即遮罩（place-items:center，框外都是它），
 *     用 e.target === e.currentTarget 判定"落在框外"，故不需要 .modal-backdrop
 *     那个 <form method="dialog">（它依赖原生 <dialog>/:target）；
 *   - 打开时把焦点移入框内首个可聚焦元素，关闭时归还给打开前的元素；
 *   - Tab / Shift+Tab 在框内循环（极简焦点陷阱：只按 DOM 顺序取可聚焦元素，
 *     不处理 iframe / 嵌套弹层等边界 —— 属有意为之的最小实现）。
 *
 * 滚动锁定无需手写：daisyUI 的 modal.css 自带
 * :root:has(.modal.modal-open){--page-scroll-lock:}，base 层的 :root{overflow:...} 随之生效。
 *
 * 不用 portal：.modal 已是 position:fixed; z-index:999，调用点祖先均无 transform/filter，
 * portal 只会引入 SSR/hydration 复杂度。
 *
 * 关闭时直接不渲染（同 ui/menu.tsx 的 MenuList），代价是没有退场动画。
 *
 * 无障碍：role/aria-modal/aria-labelledby 齐备（标题 id 由 useId 生成、经 context 下发）。
 * 不设 aria-describedby —— 要判断"调用方是否渲染了描述"才能接，悬空 IDREF 比没有更糟；
 * 改由调用方把标题写完整（如「删除工作流「X」？」）。
 */

const FOCUSABLE =
    "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

const DialogCtx = React.createContext<{ titleId: string } | null>(null);

export interface DialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** 追加到 .modal 遮罩层 */
    className?: string;
    /** 追加到 .modal-box 内容框 */
    boxClassName?: string;
    children?: React.ReactNode;
}

export function Dialog({
    open,
    onOpenChange,
    className,
    boxClassName,
    children,
}: DialogProps) {
    const titleId = React.useId();
    const boxRef = React.useRef<HTMLDivElement>(null);
    const restoreRef = React.useRef<HTMLElement | null>(null);

    // onOpenChange 放 ref：避免调用方每次渲染传新函数导致 effect 反复解绑（同 ui/menu.tsx）
    const onOpenChangeRef = React.useRef(onOpenChange);
    onOpenChangeRef.current = onOpenChange;
    const close = React.useCallback(() => onOpenChangeRef.current(false), []);

    React.useEffect(() => {
        if (!open) return;
        restoreRef.current = document.activeElement as HTMLElement | null;
        const box = boxRef.current;
        (box?.querySelector<HTMLElement>(FOCUSABLE) ?? box)?.focus();

        function onKeyDown(e: KeyboardEvent) {
            if (e.key === "Escape") {
                close();
                return;
            }
            if (e.key !== "Tab") return;
            const root = boxRef.current;
            if (!root) return;
            const items = Array.from(
                root.querySelectorAll<HTMLElement>(FOCUSABLE),
            );
            if (items.length === 0) {
                e.preventDefault();
                return;
            }
            const first = items[0]!;
            const last = items[items.length - 1]!;
            const active = document.activeElement;
            const inside = active instanceof HTMLElement && root.contains(active);
            if (e.shiftKey && (active === first || !inside)) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && (active === last || !inside)) {
                e.preventDefault();
                first.focus();
            }
        }

        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("keydown", onKeyDown);
            restoreRef.current?.focus?.();
        };
    }, [open, close]);

    if (!open) return null;

    return (
        <DialogCtx.Provider value={{ titleId }}>
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className={cn("modal modal-open", className)}
                onPointerDown={(e) => {
                    if (e.target === e.currentTarget) close();
                }}
            >
                {/* tabIndex=-1 + outline-none：焦点兜底落点（框内无可聚焦元素时）。
                 * 正常路径下焦点总是落在首个按钮上，看不到这个环。 */}
                <div
                    ref={boxRef}
                    tabIndex={-1}
                    className={cn("modal-box outline-none", boxClassName)}
                >
                    {children}
                </div>
            </div>
        </DialogCtx.Provider>
    );
}

export function DialogTitle({
    className,
    children,
}: {
    className?: string;
    children: React.ReactNode;
}) {
    const ctx = React.useContext(DialogCtx);
    return (
        <h2 id={ctx?.titleId} className={cn("text-lg font-semibold", className)}>
            {children}
        </h2>
    );
}

export function DialogActions({
    className,
    children,
}: {
    className?: string;
    children?: React.ReactNode;
}) {
    return <div className={cn("modal-action", className)}>{children}</div>;
}
