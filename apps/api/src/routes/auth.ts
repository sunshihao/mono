import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { MergeSchemaPath, Schema } from "hono/types";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { LoginRequestSchema } from "@repo/types";
import type { AppEnv, SchemaOf } from "../types.js";
import { users } from "../db/schema.js";

const scryptAsync = promisify(scrypt) as (
    password: string,
    salt: Buffer,
    keylen: number,
) => Promise<Buffer>;

// 防时序枚举：用户名不存在时也执行一次 scrypt，
// 使响应耗时与"用户存在但密码错误"一致（模块级预计算一次）。
const timingEqualizer = scryptAsync("timing-equalizer", randomBytes(16), 64)
    .then(() => undefined)
    .catch(() => undefined);

/**
 * 校验密码。存储格式 `scrypt$<saltHex>$<hashHex>`（keylen 64，
 * 与种子脚本约定一致）；格式不符视为不匹配。
 */
async function verifyPassword(
    password: string,
    stored: string,
): Promise<boolean> {
    const [scheme, saltHex, hashHex] = stored.split("$");
    if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const actual = await scryptAsync(password, salt, expected.length);
    return (
        actual.length === expected.length && timingSafeEqual(actual, expected)
    );
}

/**
 * POST /v1/auth/login —— 用户名 + 密码（scrypt）校验，返回最小用户信息。
 * db 插件未配置时 503 auth_unavailable；凭证错误统一 401 invalid_credentials
 * （不区分"用户不存在/密码错误"，配合 timingEqualizer 防枚举）。
 *
 * 类型说明同 workflows.ts：route() 返回 Schema 是 union，末尾 cast 成交叉类型；
 * app 参数必须泛型化，写死 Hono<AppEnv> 会把上游累积的 Schema 擦成 BlankSchema。
 */
export function mountAuth<S extends Schema>(app: Hono<AppEnv, S>) {
    const router = new Hono<AppEnv>().post(
        "/login",
        zValidator("json", LoginRequestSchema, (result, c) => {
            if (!result.success) {
                return c.json(
                    {
                        error: "validation_error",
                        issues: result.error.issues,
                    },
                    400,
                );
            }
        }),
        async (c) => {
            const dbService = c.var.services.db;
            if (!dbService) return c.json({ error: "auth_unavailable" }, 503);
            const { username, password } = c.req.valid("json");
            const [row] = await dbService.db
                .select({
                    id: users.id,
                    username: users.username,
                    password: users.password,
                    status: users.status,
                })
                .from(users)
                .where(eq(users.username, username))
                .limit(1);
            if (!row) {
                // 未知用户：等一次假 scrypt，避免时序差暴露用户是否存在
                await timingEqualizer;
                return c.json({ error: "invalid_credentials" }, 401);
            }
            if (
                row.status !== 1 ||
                !(await verifyPassword(password, row.password))
            ) {
                return c.json({ error: "invalid_credentials" }, 401);
            }
            return c.json({ user: { id: row.id, username: row.username } });
        },
    );

    return app.route("/v1/auth", router) as unknown as Hono<
        AppEnv,
        MergeSchemaPath<SchemaOf<typeof router>, "/v1/auth"> & S,
        "/"
    >;
}
