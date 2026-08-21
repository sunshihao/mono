import { pino, type Logger } from "pino";

/** 根 logger。LOG_PRETTY=true 时经 pino-pretty 输出（开发用）。 */
export function createLogger(level: string): Logger {
    // 显式声明形状（勿用 Parameters<typeof pino>[0]）：让 pino 的 CustomLevels 推断为 never，
    // 与 Logger 默认泛型一致
    const options: { level: string; transport?: { target: string } } = {
        level,
    };
    if (process.env.LOG_PRETTY === "true") {
        options.transport = { target: "pino-pretty" };
    }
    return pino(options);
}
