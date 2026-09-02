import { NextResponse } from "next/server";
import { LoginRequestSchema } from "@repo/types";
import { api } from "@/lib/api";
import { sessionCookieOptions, signSession } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * 登录编排：web（3001）在服务端调用 Hono API（3000）校验凭证，
 * 成功后在 web 域签发签名会话 cookie（避免跨域 cookie 与 CORS credentials）。
 * 客户端页面守卫（/ 与 /workflows/*）校验该 cookie 决定是否重定向 /login。
 */
export async function POST(req: Request) {
    let body: unknown = null;
    try {
        body = await req.json();
    } catch {
        // 非法 JSON 走 safeParse 统一 400
    }
    const parsed = LoginRequestSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { error: "invalid_credentials" },
            { status: 400 },
        );
    }

    let res: Awaited<ReturnType<typeof api.v1.auth.login.$post>>;
    try {
        res = await api.v1.auth.login.$post({ json: parsed.data });
    } catch {
        // API 未启动等网络错误
        return NextResponse.json(
            { error: "auth_unavailable" },
            { status: 503 },
        );
    }
    if (res.status === 503) {
        return NextResponse.json(
            { error: "auth_unavailable" },
            { status: 503 },
        );
    }
    if (!res.ok) {
        // 401：用户不存在/密码错误/账号禁用（API 统一 invalid_credentials）
        return NextResponse.json(
            { error: "invalid_credentials" },
            { status: 401 },
        );
    }
    const body2 = await res.json();
    const response = NextResponse.json({ ok: true });
    response.cookies.set(
        "session",
        signSession({ uid: body2.user.id, username: body2.user.username }),
        sessionCookieOptions,
    );
    return response;
}
