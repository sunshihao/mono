/**
 * 启动期配置错误：env 校验失败、插件依赖环、严格模式下必需插件缺失配置。
 * 与 HTTPException（请求期）区分，两者走不同的处理路径。
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}
