import { z } from "zod";

/**
 * 与 ../RAG（Python LlamaIndex 原型）对齐的向量库配置。
 * 原型将数据迁入 Qdrant 集合 `knowledgeOfAI`，命名向量 `text-embedding-v4`（1024 维，Cosine），
 * point id 即 LlamaIndex 的 node_id（UUID）。
 */
export const RAG_COLLECTION = "knowledgeOfAI" as const;
export const RAG_VECTOR_NAME = "text-embedding-v4" as const;
export const RAG_VECTOR_SIZE = 1024 as const;
export const RAG_DISTANCE = "Cosine" as const;

/** Qdrant point payload（对齐 migrate_to_qdrant.py 的 build_payloads） */
export const ChunkPayloadSchema = z.object({
  node_id: z.string().uuid(),
  text: z.string(),
  file_path: z.string(),
  file_name: z.string(),
  file_type: z.string(),
  node_type: z.string(),
  ref_doc_id: z.string().uuid(),
  document_id: z.string().uuid(),
  start_char_idx: z.number().int().nonnegative(),
  end_char_idx: z.number().int().nonnegative(),
  /** sha256 hex（64 位），node 文本 + 元数据的去重键（源自原型 docstore/metadata.doc_hash） */
  doc_hash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type ChunkPayload = z.infer<typeof ChunkPayloadSchema>;

/** 源文件元数据（原型的 docstore metadata，日期为字符串） */
export const FileMetadataSchema = z.object({
  file_path: z.string(),
  file_name: z.string(),
  file_type: z.string(),
  file_size: z.number().int().nonnegative(),
  creation_date: z.string(),
  last_modified_date: z.string(),
});
export type FileMetadata = z.infer<typeof FileMetadataSchema>;
