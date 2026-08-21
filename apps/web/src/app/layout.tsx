import type { Metadata } from "next";
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
    return (
        <html lang="zh-CN">
            <body className="min-h-screen bg-background font-sans text-foreground antialiased">
                {children}
            </body>
        </html>
    );
}
