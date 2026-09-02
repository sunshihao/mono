"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/** 退出登录按钮（layout header 中渲染） */
export function LogoutButton() {
    const router = useRouter();

    async function handleLogout() {
        await fetch("/api/auth/logout", { method: "POST" });
        router.push("/login");
        router.refresh();
    }

    return (
        <Button variant="outline" size="sm" onClick={handleLogout}>
            退出登录
        </Button>
    );
}
