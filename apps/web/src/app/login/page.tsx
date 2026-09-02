import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginForm } from "@/components/login-form";

/** 登录页：已登录访问直接回首页（防守卫-登录页死循环） */
export default async function LoginPage() {
    const session = getSession();
    if (session) redirect("/");

    return (
        <main className="flex min-h-screen items-center justify-center p-6">
            <LoginForm />
        </main>
    );
}
