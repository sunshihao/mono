import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import * as schema from "../../db/schema.js";
import type { DbService } from "../../types.js";
import type { Plugin } from "../types.js";

const { Pool } = pg;

const ConfigSchema = z.object({
  DATABASE_URL: z.string().url(),
});
type Config = z.infer<typeof ConfigSchema>;

/** drizzle-orm + PostgreSQL：元数据/工作流版本。pool 懒建连，连不上不影响启动。 */
export const dbPlugin: Plugin<DbService> = {
  name: "db",
  version: "0.1.0",
  configSchema: ConfigSchema,
  async init(ctx) {
    const { DATABASE_URL } = ctx.cfg as Config;
    const pool = new Pool({ connectionString: DATABASE_URL, max: 10 });
    // 空闲连接出错（如 PG 重启）时避免进程崩溃
    pool.on("error", (err) => console.error("[db] idle client error:", err.message));
    const db = drizzle(pool, { schema });
    ctx.onShutdown(async () => {
      await pool.end();
    });
    return { db, pool };
  },
  async health(service) {
    try {
      await service.pool.query("SELECT 1");
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : "SELECT 1 failed" };
    }
  },
};
