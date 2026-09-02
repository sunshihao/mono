import type { Metadata } from "next";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { UserMenu } from "@/components/user-menu";
import "./globals.css";

export const metadata: Metadata = {
    title: "RAG 工作台",
    description:
        "Hono 网关 + LangGraph 编排 + LlamaIndexTS 检索 —— 工作流画布与知识库问答",
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    // cookies() 为 dynamic API：登录后所有路由动态渲染（预期行为）
    const session = getSession();

    return (
        <html lang="zh-CN">
            <body className="min-h-screen bg-background font-sans text-foreground antialiased">
                {/* 首帧前按 localStorage（无则系统偏好）加 .dark，避免暗色主题闪白 */}
                <script
                    dangerouslySetInnerHTML={{
                        __html: `try{var t=localStorage.getItem("theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`,
                    }}
                />
                {session && (
                    <header className="flex items-center justify-between border-b px-6 py-3">
                        <Link href="/" className="flex items-center gap-2">
                            <span className="flex h-10 w-10 items-center justify-center rounded-sm rounded-r-lg bg-[#e5e7eb] p-1.5 shadow-sm dark:bg-neutral-800">
                                <img
                                    src="/logo.svg"
                                    alt="RAG 工作台 logo"
                                    className="h-full w-full dark:invert"
                                />
                            </span>
                            <span className="text-base font-semibold tracking-tight">
                                RAG 工作台
                            </span>
                        </Link>
                        <UserMenu username={session.username} />
                    </header>
                )}
                {children}
            </body>
        </html>
    );
}
