import { describe, expect, it } from "vitest";
import {
    adapterFor,
    confluenceAdapter,
    notionAdapter,
} from "../src/adapters.js";
import { sha256Hex } from "../src/hash.js";

describe("notionAdapter", () => {
    it("规范化 page.updated 事件", () => {
        const body = {
            type: "page.updated",
            data: {
                page_id: "page-123",
                workspace_id: "ws-9",
                last_edited_time: "2026-08-22T10:00:00Z",
            },
        };
        const result = notionAdapter.normalize(body);
        expect(result).toEqual({
            path: "notion://ws-9/page-123",
            doc_hash: sha256Hex("page-123|2026-08-22T10:00:00Z"),
            mtime: "2026-08-22T10:00:00Z",
        });
    });

    it("非法 body 返回 null（缺字段/错误类型）", () => {
        expect(notionAdapter.normalize({ type: "page.updated" })).toBeNull();
        expect(notionAdapter.normalize({ type: "other" })).toBeNull();
        expect(notionAdapter.normalize("not-an-object")).toBeNull();
    });
});

describe("confluenceAdapter", () => {
    it("规范化 page_updated 事件", () => {
        const body = {
            eventType: "page_updated",
            page: {
                id: "987654321",
                spaceKey: "KB",
                title: "架构文档",
                version: 3,
            },
        };
        const result = confluenceAdapter.normalize(body);
        expect(result).toEqual({
            path: "confluence://KB/987654321",
            doc_hash: sha256Hex("KB|987654321|v3"),
        });
    });

    it("非法 body 返回 null", () => {
        expect(confluenceAdapter.normalize({ eventType: "page_created" })).toBeNull();
        expect(confluenceAdapter.normalize(null)).toBeNull();
    });
});

describe("adapterFor", () => {
    it("按源名路由到适配器", () => {
        expect(adapterFor("notion")).toBe(notionAdapter);
        expect(adapterFor("confluence")).toBe(confluenceAdapter);
        expect(adapterFor("webhook")).toBeUndefined();
        expect(adapterFor("unknown")).toBeUndefined();
    });
});
