import type { MiddlewareHandler } from "hono";
import type { AppEnv, Services } from "../types.js";

/** 把注册表产出的服务映射注入 Hono context，路由内经 c.var.services.<plugin> 访问 */
export function injectServices(services: Services): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set("services", services);
    await next();
  };
}
