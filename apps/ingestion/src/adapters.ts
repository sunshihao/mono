import { z } from "zod";
import { sha256Hex } from "./hash.js";

/**
 * SaaS 数据源 webhook 适配器。
 * Notion/Confluence 的 webhook 只通知"内容变化"（不含正文），
 * 骨架期约定：由推送方附带的 id+版本信息推导内容指针与去重 hash
 * （正文拉取与再嵌入由后续"连接器"里程碑实现）。
 */
export interface NormalizedEvent {
    path: string;
    doc_hash: string;
    mtime?: string;
}

export interface SourceAdapter {
    normalize(body: unknown): NormalizedEvent | null;
}

/** Notion webhook 示意 body（page.updated 事件） */
const NotionWebhookSchema = z.object({
    type: z.literal("page.updated"),
    data: z.object({
        page_id: z.string().min(1),
        workspace_id: z.string().min(1),
        last_edited_time: z.string().datetime(),
    }),
});

export const notionAdapter: SourceAdapter = {
    normalize(body) {
        const parsed = NotionWebhookSchema.safeParse(body);
        if (!parsed.success) return null;
        const { page_id, workspace_id, last_edited_time } = parsed.data.data;
        return {
            path: `notion://${workspace_id}/${page_id}`,
            doc_hash: sha256Hex(`${page_id}|${last_edited_time}`),
            mtime: last_edited_time,
        };
    },
};

/** Confluence webhook 示意 body（page_updated 事件） */
const ConfluenceWebhookSchema = z.object({
    eventType: z.literal("page_updated"),
    page: z.object({
        id: z.string().min(1),
        spaceKey: z.string().min(1),
        title: z.string(),
        version: z.number().int().positive(),
    }),
});

export const confluenceAdapter: SourceAdapter = {
    normalize(body) {
        const parsed = ConfluenceWebhookSchema.safeParse(body);
        if (!parsed.success) return null;
        const { id, spaceKey, version } = parsed.data.page;
        return {
            path: `confluence://${spaceKey}/${id}`,
            doc_hash: sha256Hex(`${spaceKey}|${id}|v${version}`),
        };
    },
};

const adapters: Record<string, SourceAdapter> = {
    notion: notionAdapter,
    confluence: confluenceAdapter,
};

/** 按源名取适配器（未知源返回 undefined） */
export function adapterFor(source: string): SourceAdapter | undefined {
    return adapters[source];
}
