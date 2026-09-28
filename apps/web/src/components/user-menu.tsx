"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Menu, MenuHandler, MenuList, MenuItem } from "@/components/ui";

type Theme = "light" | "dark";

const THEME_KEY = "theme";

function currentTheme(): Theme {
    // hydration 时 html 已由 layout 的 inline script 写好 data-theme
    return document.documentElement.getAttribute("data-theme") === "dark"
        ? "dark"
        : "light";
}

function applyTheme(theme: Theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try {
        localStorage.setItem(THEME_KEY, theme);
    } catch {
        // localStorage 不可用（隐私模式等）时仅本次会话生效
    }
}

/**
 * 用户区（header 左侧）：头像（用户名首字母）+ 用户名；
 * 点击展开 ui/Menu ——浅色/暗色切换 + 退出登录。
 * 注：头像为纯排版内容，保持原生 span（daisyUI 的 avatar 需要 <img>）。
 */
export function UserMenu({ username }: { username: string }) {
    const router = useRouter();
    // 初始浅色；挂载后（hydration 完成、html 的 data-theme 已由 inline script 写入）
    // 同步真实主题 —— useState initializer 在 SSR 也会执行，不能在那里读 document
    const [theme, setTheme] = useState<Theme>("light");

    useEffect(() => {
        setTheme(currentTheme());
    }, []);

    function handleThemePick(next: Theme) {
        setTheme(next);
        applyTheme(next);
    }

    async function handleLogout() {
        await fetch("/api/auth/logout", { method: "POST" });
        router.push("/login");
        router.refresh();
    }

    return (
        <Menu placement="bottom-end">
            <MenuHandler>
                <button
                    type="button"
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-base-200"
                    aria-label={`用户菜单（${username}）`}
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
            </MenuHandler>
            <MenuList className="w-48 min-w-0 border border-border bg-card p-1 text-sm shadow-md">
                <p className="px-3 py-1.5 text-xs text-muted-foreground">
                    主题调整
                </p>
                <MenuItem
                    onClick={() => handleThemePick("light")}
                    className="flex w-full items-center justify-between"
                >
                    浅色
                    {theme === "light" && (
                        <span className="text-xs text-muted-foreground">✓</span>
                    )}
                </MenuItem>
                <MenuItem
                    onClick={() => handleThemePick("dark")}
                    className="flex w-full items-center justify-between"
                >
                    暗色
                    {theme === "dark" && (
                        <span className="text-xs text-muted-foreground">✓</span>
                    )}
                </MenuItem>
                <MenuItem
                    onClick={() => void handleLogout()}
                    className="flex w-full items-center justify-between text-destructive hover:bg-destructive/10 focus:bg-destructive/10"
                >
                    退出登录
                </MenuItem>
            </MenuList>
        </Menu>
    );
}
