import type { Redis } from "ioredis";
import type { Logger } from "pino";
import {
    INGESTION_GROUP,
    INGESTION_STREAM,
    IngestionEventEnvelopeSchema,
} from "@repo/types";
import type { Indexer } from "./indexer.js";

export interface Consumer {
    stop(): void;
}

/**
 * Stream 消费端（Consumer Group）：
 *   XGROUP CREATE（幂等，MKSTREAM）→ XREADGROUP 阻塞循环 → 事件分发 → XACK。
 * 事件分发语义（骨架期）：
 *   - fs 来源：读本地文件 → indexer 切分/嵌入/upsert
 *   - webhook/poll 来源：path 非本地文件，记 skipped 并 ack（避免死循环）
 * 处理失败也 ack（记录日志）——否则坏事件会阻塞消费。
 */
export async function startConsumer(
    redis: Redis,
    indexer: Indexer,
    logger: Logger,
): Promise<Consumer> {
    await redis
        .xgroup("CREATE", INGESTION_STREAM, INGESTION_GROUP, "0", "MKSTREAM")
        .catch((err: Error) => {
            if (!err.message.includes("BUSYGROUP")) throw err;
        });

    let running = true;

    async function handleEvent(id: string, fields: string[]): Promise<void> {
        const raw = fields[fields.indexOf("event") + 1];
        if (!raw) {
            logger.warn({ id }, "event missing payload, ack and skip");
            return;
        }
        const parsed = IngestionEventEnvelopeSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) {
            logger.warn(
                { id, issues: parsed.error.issues },
                "invalid envelope, ack and skip",
            );
            return;
        }
        const envelope = parsed.data;
        if (envelope.source !== "fs") {
            logger.info(
                { id, source: envelope.source, path: envelope.path },
                "non-fs event skipped (webhook/poll indexing is a later milestone)",
            );
            return;
        }
        const result = await indexer.ingestFile(
            envelope.path,
            envelope.doc_hash,
        );
        logger.info({ id, result }, "document indexed");
    }

    const loop = async (): Promise<void> => {
        while (running) {
            try {
                const results = await redis.xreadgroup(
                    "GROUP",
                    INGESTION_GROUP,
                    `consumer-${process.pid}`,
                    "COUNT",
                    10,
                    "BLOCK",
                    5000,
                    "STREAMS",
                    INGESTION_STREAM,
                    ">",
                );
                if (!results) continue;
                for (const [, entries] of results) {
                    for (const [id, rawFields] of entries) {
                        const fields = rawFields ?? [];
                        try {
                            await handleEvent(id, fields);
                        } catch (err) {
                            logger.error(
                                { err, id },
                                "event processing failed, ack and continue",
                            );
                        } finally {
                            await redis.xack(
                                INGESTION_STREAM,
                                INGESTION_GROUP,
                                id,
                            );
                        }
                    }
                }
            } catch (err) {
                logger.error({ err }, "consumer loop error, retrying in 1s");
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }
    };

    void loop();
    logger.info(
        { stream: INGESTION_STREAM, group: INGESTION_GROUP },
        "stream consumer started",
    );

    return {
        stop: () => {
            running = false;
        },
    };
}
