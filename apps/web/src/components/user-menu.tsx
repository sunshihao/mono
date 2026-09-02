"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Theme = "light" | "dark";

const THEME_KEY = "theme";

function currentTheme(): Theme {
    // hydration 时 html 已由 layout 的 inline script 加好 .dark 类
    return document.documentElement.classList.contains("dark")
        ? "dark"
        : "light";
}

function applyTheme(theme: Theme) {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
        localStorage.setItem(THEME_KEY, theme);
    } catch {
        // localStorage 不可用（隐私模式等）时仅本次会话生效
    }
}

/**
 * 用户区（header 左侧）：头像（用户名首字母）+ 用户名；
 * hover 弹出菜单：主题调整（二级选择明/暗）+ 退出登录。
 */
export function UserMenu({ username }: { username: string }) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    // 初始浅色；挂载后（hydration 完成、html 的 .dark 类已由 inline script 设置）
    // 同步真实主题 —— useState initializer 在 SSR 也会执行，不能在那里读 document
    const [theme, setTheme] = useState<Theme>("light");
    const [themeOpen, setThemeOpen] = useState(false);
    // 关闭缓冲：按钮与弹窗之间的空隙（mt-2）不属任何元素，
    // 鼠标跨越瞬间会触发 onMouseLeave —— 延迟关闭，进入弹窗即取消
    const closeTimer = useRef<number | null>(null);

    useEffect(() => {
        setTheme(currentTheme());
    }, []);

    function cancelClose() {
        if (closeTimer.current !== null) {
            window.clearTimeout(closeTimer.current);
            closeTimer.current = null;
        }
    }

    function scheduleClose() {
        cancelClose();
        closeTimer.current = window.setTimeout(() => {
            setOpen(false);
            setThemeOpen(false);
        }, 200);
    }

    function close() {
        cancelClose();
        setOpen(false);
        setThemeOpen(false);
    }

    function handleThemePick(next: Theme) {
        setTheme(next);
        applyTheme(next);
        close();
    }

    async function handleLogout() {
        await fetch("/api/auth/logout", { method: "POST" });
        router.push("/login");
        router.refresh();
    }

    return (
        <div
            className="relative"
            onMouseEnter={() => {
                cancelClose();
                setOpen(true);
            }}
            onMouseLeave={scheduleClose}
        >
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
                aria-haspopup="menu"
                aria-expanded={open}
            >
                <span
                    aria-hidden
                    className="flex h-8 w-8 select-none items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground"
                >
                    {username.slice(0, 1).toUpperCase()}
                </span>
                <span className="text-sm text-muted-foreground">
                    {username}
                </span>
            </button>

            {open && (
                <div
                    role="menu"
                    className="absolute right-0 top-full z-50 mt-2 w-48 rounded-md border bg-card p-1 text-sm shadow-md"
                >
                    {/* 主题调整：hover 展开明/暗二级菜单 */}
                    <div className="relative">
                        <button
                            type="button"
                            role="menuitem"
                            onMouseEnter={() => setThemeOpen(true)}
                            className="flex w-full items-center justify-between rounded px-3 py-2 text-left hover:bg-accent"
                        >
                            <span>主题调整</span>
                            <span className="text-xs text-muted-foreground">
                                {theme === "dark" ? "暗色" : "浅色"} ›
                            </span>
                        </button>
                        {themeOpen && (
                            <div
                                role="menu"
                                className="absolute right-full top-0 mr-1 w-36 rounded-md border bg-card p-1 shadow-md"
                            >
                                <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => handleThemePick("light")}
                                    className="flex w-full items-center justify-between rounded px-3 py-2 text-left hover:bg-accent"
                                >
                                    浅色
                                    {theme === "light" && (
                                        <span className="text-xs text-muted-foreground">
                                            ✓
                                        </span>
                                    )}
                                </button>
                                <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => handleThemePick("dark")}
                                    className="flex w-full items-center justify-between rounded px-3 py-2 text-left hover:bg-accent"
                                >
                                    暗色
                                    {theme === "dark" && (
                                        <span className="text-xs text-muted-foreground">
                                            ✓
                                        </span>
                                    )}
                                </button>
                            </div>
                        )}
                    </div>
                    <div className="my-1 h-px bg-border" />
                    <button
                        type="button"
                        role="menuitem"
                        onClick={handleLogout}
                        className="w-full rounded px-3 py-2 text-left text-destructive hover:bg-destructive/10"
                    >
                        退出登录
                    </button>
                </div>
            )}
        </div>
    );
}
