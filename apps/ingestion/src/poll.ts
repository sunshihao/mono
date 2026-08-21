import type { Logger } from "pino";
import { computeFileHashes } from "./hash.js";
import type { StreamClient } from "./stream.js";

export interface Poller {
    stop(): void;
}

/**
 * 定时轮询兜底（chokidar 失效 / 挂载卷事件丢失场景，旧系统 Hash 比对语义）：
 * 首轮扫描建基线（不发事件）；之后仅对"已知文件内容变化"发布 poll 事件。
 * 与 watcher 并存时可能有少量重复事件 —— 消费端按 doc_hash 幂等去重。
 */
export function startPoller(
    dir: string,
    intervalMs: number,
    stream: StreamClient,
    logger: Logger,
): Poller {
    const known = new Map<string, string>();

    const scan = async (): Promise<void> => {
        try {
            const current = await computeFileHashes(dir);
            for (const [path, hash] of current) {
                const prev = known.get(path);
                if (prev === hash) continue;
                if (prev === undefined) {
                    known.set(path, hash);
                    continue; // 新文件由 watcher 负责，轮询只兜底"变化"
                }
                known.set(path, hash);
                await stream.publish("poll", path, hash);
            }
        } catch (err) {
            logger.warn({ err, dir }, "poller: scan failed");
        }
    };

    void scan();
    const timer = setInterval(() => void scan(), intervalMs);
    timer.unref();
    logger.info({ dir, intervalMs }, "poll fallback started");

    return {
        stop: () => {
            clearInterval(timer);
        },
    };
}
