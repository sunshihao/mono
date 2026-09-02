import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * 登录会话：HMAC-SHA256 签名 cookie（payload.sig，payload 为
 * base64url(JSON)，签名密钥 AUTH_SECRET 运行时注入，勿用 NEXT_PUBLIC_ 前缀）。
 * fail-closed：AUTH_SECRET 缺失/过短时 getSession 恒为 null、signSession 抛错，
 * 绝不回退默认密钥。
 */

const SESSION_COOKIE = "session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 天

export interface Session {
    uid: number;
    username: string;
}

interface SessionPayload extends Session {
    /** 过期时间（unix 秒） */
    exp: number;
}

export const sessionCookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
    secure: process.env.NODE_ENV === "production",
};

function getSecret(): string | null {
    const secret = process.env.AUTH_SECRET;
    if (!secret || secret.length < 32) {
        console.error(
            "[auth] AUTH_SECRET 未配置或过短，会话校验一律失败（fail-closed）",
        );
        return null;
    }
    return secret;
}

function sign(payload: string, secret: string): string {
    return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** 签发会话 token（登录成功后由 /api/auth/login 写入 cookie） */
export function signSession(session: Session): string {
    const secret = getSecret();
    if (!secret) throw new Error("AUTH_SECRET 未配置，无法签发会话");
    const payload = Buffer.from(
        JSON.stringify({
            ...session,
            exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
        }),
    ).toString("base64url");
    return `${payload}.${sign(payload, secret)}`;
}

/** 校验签名与有效期，返回会话或 null（任何异常/格式不符均视为无效） */
export function verifySession(token: string): Session | null {
    const secret = getSecret();
    if (!secret) return null;
    const [payload, sig] = token.split(".");
    if (!payload || !sig) return null;
    const expected = sign(payload, secret);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
        const data = JSON.parse(
            Buffer.from(payload, "base64url").toString("utf8"),
        ) as SessionPayload;
        if (
            typeof data.exp !== "number" ||
            data.exp * 1000 <= Date.now() ||
            typeof data.uid !== "number" ||
            typeof data.username !== "string"
        ) {
            return null;
        }
        return { uid: data.uid, username: data.username };
    } catch {
        return null;
    }
}

/** 读取当前请求的会话（server component / route handler 中调用） */
export function getSession(): Session | null {
    const token = cookies().get(SESSION_COOKIE)?.value;
    if (!token) return null;
    return verifySession(token);
}
