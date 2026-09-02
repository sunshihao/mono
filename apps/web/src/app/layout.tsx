import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { LogoutButton } from "@/components/logout-button";
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
                {session && (
                    <header className="flex items-center justify-between border-b px-6 py-3">
                        <span className="text-sm text-muted-foreground">
                            已登录：{session.username}
                        </span>
                        <LogoutButton />
                    </header>
                )}
                {children}
            </body>
        </html>
    );
}
