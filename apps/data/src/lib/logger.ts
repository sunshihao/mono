import { pino, type Logger } from "pino";

export function createLogger(level: string): Logger {
    const options: { level: string; transport?: { target: string } } = { level };
    if (process.env.LOG_PRETTY === "true") {
        options.transport = { target: "pino-pretty" };
    }
    return pino(options);
}
