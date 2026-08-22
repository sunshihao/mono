import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import {
    INGESTION_NOTIFICATION_CHANNEL,
    INGESTION_STREAM,
    type IngestionEventEnvelope,
    type IngestionSource,
} from "@repo/types";

/**
 * 统一摄入队列入口：所有来源的事件都以信封格式 XADD 到 Redis Stream
 * （INGESTION_STREAM，consumer group 由消费端创建）。
 * redis 未配置 → warn + 跳过（服务保持可用，仅失事件）。
 */
export interface StreamClient {
    publish(
        source: IngestionSource,
        path: string,
        doc_hash: string,
    ): Promise<IngestionEventEnvelope>;
}

export function createStreamClient(
    redis: Redis | null,
    logger: Logger,
): StreamClient {
    return {
        async publish(source, path, doc_hash) {
            const envelope: IngestionEventEnvelope = {
                id: randomUUID(),
                source,
                path,
                doc_hash,
                mtime: new Date().toISOString(),
                status: "pending",
            };
            if (!redis) {
                logger.warn(
                    { envelope },
                    "redis not configured, skipping XADD",
                );
                return envelope;
            }
            await redis.xadd(
                INGESTION_STREAM,
                "*",
                "event",
                JSON.stringify(envelope),
            );
            // PubSub 通知：订阅 INGESTION_NOTIFICATION_CHANNEL 的服务
            // （如 api 侧缓存失效/实时推送）可即时感知新摄入事件
            await redis
                .publish(
                    INGESTION_NOTIFICATION_CHANNEL,
                    JSON.stringify({ event: "ingested", envelope }),
                )
                .catch(() => undefined);
            logger.info({ envelope }, "ingestion event published");
            return envelope;
        },
    };
}
