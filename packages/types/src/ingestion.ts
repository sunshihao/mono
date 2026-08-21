import { z } from "zod";

/**
 * 摄入队列消息信封（未来 apps/ingestion 生产/消费）。
 * 统一写入 ioredis Stream（XADD）→ Consumer Group 消费；doc_hash 复用 ../RAG 的去重键。
 */
export const INGESTION_STREAM = "ingestion:events" as const;
export const INGESTION_GROUP = "ingestion-service" as const;

export const IngestionSourceSchema = z.enum(["fs", "webhook", "poll"]);
export type IngestionSource = z.infer<typeof IngestionSourceSchema>;

export const IngestionEventStatusSchema = z.enum([
  "pending",
  "processing",
  "done",
  "failed",
  "skipped",
]);
export type IngestionEventStatus = z.infer<typeof IngestionEventStatusSchema>;

export const IngestionEventEnvelopeSchema = z.object({
  id: z.string().uuid(),
  source: IngestionSourceSchema,
  /** 源路径（fs: 本地/挂载路径；webhook/poll: 数据源标识 + 资源路径） */
  path: z.string(),
  /** sha256 hex（64 位），与上次比对判重的依据 */
  doc_hash: z.string().regex(/^[0-9a-f]{64}$/),
  mtime: z.string().datetime(),
  status: IngestionEventStatusSchema.default("pending"),
});
export type IngestionEventEnvelope = z.infer<typeof IngestionEventEnvelopeSchema>;
