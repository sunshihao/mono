import { describe, expect, it } from "vitest";
import {
  WorkflowCreateInputSchema,
  QueryRequestSchema,
  ChunkPayloadSchema,
  IngestionEventEnvelopeSchema,
  RAG_COLLECTION,
  RAG_VECTOR_NAME,
} from "../src/index.js";

const validGraph = {
  nodes: [
    { id: "n1", type: "start", config: {} },
    { id: "n2", type: "llm", label: "回答", config: { model: "qwen-plus" } },
    { id: "n3", type: "end", config: {} },
  ],
  edges: [
    { id: "e1", source: "n1", target: "n2" },
    { id: "e2", source: "n2", target: "n3" },
  ],
};

describe("WorkflowCreateInputSchema", () => {
  it("接受合法的工作流创建输入", () => {
    const result = WorkflowCreateInputSchema.parse({ name: "知识问答", graph: validGraph });
    expect(result.name).toBe("知识问答");
    expect(result.graph.nodes).toHaveLength(3);
  });

  it("拒绝未知节点类型", () => {
    const bad = { name: "x", graph: { nodes: [{ id: "n1", type: "banana" }], edges: [] } };
    expect(() => WorkflowCreateInputSchema.parse(bad)).toThrow();
  });

  it("边引用不存在的节点不会被 schema 拦截（图校验在 api 层）", () => {
    const dangling = {
      name: "x",
      graph: { nodes: [{ id: "n1", type: "end" }], edges: [{ id: "e1", source: "ghost", target: "n1" }] },
    };
    expect(() => WorkflowCreateInputSchema.parse(dangling)).not.toThrow();
  });
});

describe("QueryRequestSchema", () => {
  it("topK 默认 5", () => {
    expect(QueryRequestSchema.parse({ query: "什么是 RAG？" }).topK).toBe(5);
  });

  it("拒绝空查询", () => {
    expect(() => QueryRequestSchema.parse({ query: "" })).toThrow();
  });
});

describe("ChunkPayloadSchema（对齐 ../RAG 迁移数据）", () => {
  it("接受原型 migrate_to_qdrant.py 生成的 payload 形状", () => {
    const payload = {
      node_id: "8f3b9f2c-1a2b-4c5d-9e8f-7a6b5c4d3e2f",
      text: "RAG 结合检索与生成……",
      file_path: "data/面试题/rag.md",
      file_name: "rag.md",
      file_type: "text/markdown",
      node_type: "TextNode",
      ref_doc_id: "11111111-1111-1111-1111-111111111111",
      document_id: "22222222-2222-2222-2222-222222222222",
      start_char_idx: 0,
      end_char_idx: 512,
      doc_hash: "a".repeat(64),
    };
    expect(ChunkPayloadSchema.parse(payload).node_id).toBe(payload.node_id);
  });

  it("doc_hash 必须是 64 位 sha256 hex", () => {
    const valid = {
      node_id: "8f3b9f2c-1a2b-4c5d-9e8f-7a6b5c4d3e2f",
      text: "t",
      file_path: "p",
      file_name: "f",
      file_type: "text/plain",
      node_type: "TextNode",
      ref_doc_id: "11111111-1111-1111-1111-111111111111",
      document_id: "22222222-2222-2222-2222-222222222222",
      start_char_idx: 0,
      end_char_idx: 1,
      doc_hash: "b".repeat(64),
    };
    expect(ChunkPayloadSchema.parse(valid).doc_hash).toHaveLength(64);
    expect(() => ChunkPayloadSchema.parse({ ...valid, doc_hash: "short" })).toThrow();
  });

  it("暴露原型集合与向量常量", () => {
    expect(RAG_COLLECTION).toBe("knowledgeOfAI");
    expect(RAG_VECTOR_NAME).toBe("text-embedding-v4");
  });
});

describe("IngestionEventEnvelopeSchema", () => {
  it("status 默认 pending，接受 fs 来源", () => {
    const envelope = IngestionEventEnvelopeSchema.parse({
      id: "33333333-3333-3333-3333-333333333333",
      source: "fs",
      path: "/data/docs/a.md",
      doc_hash: "c".repeat(64),
      mtime: "2026-08-21T10:00:00Z",
    });
    expect(envelope.status).toBe("pending");
  });
});
