import { watch, type FSWatcher } from "chokidar";
import { readFile } from "node:fs/promises";
import type { Logger } from "pino";
import { computeFileHashes, sha256Hex } from "./hash.js";
import type { StreamClient } from "./stream.js";

export interface Watcher {
    close(): Promise<void>;
}

/**
 * chokidar 实时监听（add/change）。启动时先对存量文件建 hash 基线
 * （基线不触发事件）；之后按内容 hash 去重，相同内容不重复发布。
 */
export async function startWatcher(
    dir: string,
    stream: StreamClient,
    logger: Logger,
): Promise<Watcher> {
    const baseline = await computeFileHashes(dir);
    const processed = new Set(baseline.values());

    const handleFile = async (path: string): Promise<void> => {
        try {
            const content = await readFile(path);
            const hash = sha256Hex(content);
            if (processed.has(hash)) return;
            processed.add(hash);
            await stream.publish("fs", path, hash);
        } catch (err) {
            logger.warn({ err, path }, "watcher: failed to process file");
        }
    };

    const watcher: FSWatcher = watch(dir, { ignoreInitial: true });
    watcher.on("add", handleFile);
    watcher.on("change", handleFile);
    watcher.on("error", (err) => logger.error({ err }, "chokidar error"));
    logger.info({ dir, baselineFiles: baseline.size }, "fs watcher started");

    return {
        close: async () => {
            await watcher.close();
        },
    };
}
