import { NextResponse } from "next/server";
import { sessionCookieOptions } from "@/lib/auth";

export const runtime = "nodejs";

/** 退出登录：清空会话 cookie（path/maxAge 与登录时一致才能生效） */
export async function POST() {
    const response = NextResponse.json({ ok: true });
    response.cookies.set("session", "", {
        ...sessionCookieOptions,
        maxAge: 0,
    });
    return response;
}
