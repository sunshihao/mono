import { createDataContext } from "./context.js";
import { startServe } from "./serve.js";

/**
 * data-service 入口（serve 一体化：webhook + worker + reconcile）。
 * 长驻 Node 进程（非 Edge）。详见 README。
 */
const ctx = createDataContext();
const shutdownFn = await startServe(ctx);

let shuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    ctx.logger.info({ signal }, "shutting down");
    await shutdownFn();
    process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
