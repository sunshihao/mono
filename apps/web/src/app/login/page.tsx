import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginForm } from "@/components/login-form";

/** 登录页：已登录访问直接回首页（防守卫-登录页死循环） */
export default async function LoginPage() {
    const session = getSession();
    if (session) redirect("/");

    return (
        <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-6">
            <div className="flex items-center gap-3">
                <img
                    src="/logo.svg"
                    alt="RAG 工作台 logo"
                    className="h-10 w-10 dark:invert"
                />
                <div>
                    <p className="text-xl font-bold tracking-tight">
                        RAG 工作台
                    </p>
                    <p className="text-xs text-muted-foreground">
                        工作流编排 · 知识库问答 · MCP 接入
                    </p>
                </div>
            </div>
            <LoginForm />
        </main>
    );
}
