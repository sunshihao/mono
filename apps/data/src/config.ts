import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";

/**
 * sync.config.yaml 加载与校验（设计 §3）。
 * 仓库 <-> 向量库 映射的唯一真源；字符串值支持 env:VAR 注入。
 * zod v3（全仓钉 v3，勿升 v4）。
 */

/** Qdrant collection 命名约束（服务端要求小写字母/数字/下划线/连字符） */
const COLLECTION_NAME = /^[a-z0-9_-]{1,255}$/;

export const ChunkingSchema = z.object({
    strategy: z
        .enum(["auto", "fixed_size", "markdown_aware", "code_aware"])
        .default("auto"),
    /** 每块字符数（≈token 数：中文约 1 字符/1 token，英文约 4 字符/1 token） */
    chunk_size: z.number().int().positive().default(800),
    /** 相邻块重叠字符数 */
    overlap: z.number().int().nonnegative().default(100),
});
export type ChunkingConfig = z.infer<typeof ChunkingSchema>;

export const RepoSchema = z.object({
    /** 内部唯一名（状态文件名 / Redis 流名用它） */
    name: z
        .string()
        .min(1)
        .regex(/^[a-z0-9_-]+$/, "repo name must be [a-z0-9_-]"),
    /** GitHub 全名 org/repo，webhook payload 的 repository.full_name 匹配键 */
    github: z
        .string()
        .min(1)
        .regex(/^[\w.-]+\/[\w.-]+$/, "github must be org/repo"),
    local_path: z.string().min(1),
    branch: z.string().min(1).default("main"),
    collection: z.string().regex(COLLECTION_NAME),
    include: z.array(z.string()).min(1).default(["**/*"]),
    exclude: z.array(z.string()).default([]),
    chunking: ChunkingSchema.default({}),
    webhook_secret_ref: z.string().optional(),
});
export type RepoConfig = z.infer<typeof RepoSchema>;

export const ConfigSchema = z.object({
    version: z.literal(1),
    vector_store: z.object({
        provider: z.literal("qdrant"),
        // env:VAR 笔误（小写名不匹配引用语法）会以字面量形式残留：
        // zod v3 url() 允许无 scheme 的 URL，故再加 http(s) 前缀约束兜底报错
        url: z
            .string()
            .url()
            .refine((u) => /^https?:\/\//i.test(u), "must be an http(s) URL"),
        api_key: z.string().optional(),
    }),
    embedding: z.object({
        provider: z.enum(["dashscope", "openai"]).default("dashscope"),
        model: z.string().min(1).default("text-embedding-v4"),
        dimensions: z.number().int().positive().default(1024),
        batch_size: z.number().int().positive().default(16),
        base_url: z.string().url().optional(),
        api_key: z.string().optional(),
    }),
    repositories: z.array(RepoSchema).min(1),
});
export type DataConfig = z.infer<typeof ConfigSchema>;

const ENV_REF = /^env:([A-Z][A-Z0-9_]*)$/;

/**
 * 递归解析 env:VAR 引用。
 * 一般字段缺失环境变量 → 抛错（fail-fast，避免把空串写进向量库配置）；
 * 例外：webhook_secret_ref 缺失 → 移除该字段（webhook 未配 secret 时仅
 * 拒绝该仓库的 push 请求，不影响 sync CLI / dry-run 等无需 secret 的路径）。
 */
export function resolveEnvRefs(
    input: unknown,
    env: Record<string, string | undefined> = process.env,
): unknown {
    if (typeof input === "string") {
        const match = ENV_REF.exec(input);
        if (!match) return input;
        const value = env[match[1]!];
        if (value === undefined || value === "") {
            throw new Error(`env ref "${input}": ${match[1]} is not set`);
        }
        return value;
    }
    if (Array.isArray(input)) {
        return input.map((v) => resolveEnvRefs(v, env));
    }
    if (input !== null && typeof input === "object") {
        const out: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(input)) {
            if (key === "webhook_secret_ref" && typeof value === "string") {
                const match = ENV_REF.exec(value);
                if (match && !env[match[1]!]) {
                    continue; // secret 未配置：省略字段，webhook 端 fail-safe 拒绝
                }
            }
            out[key] = resolveEnvRefs(value, env);
        }
        return out;
    }
    return input;
}

/** YAML 文本 → 校验后的配置（env 注入 + zod + 仓库名去重） */
export function parseConfigYaml(
    raw: string,
    env: Record<string, string | undefined> = process.env,
): DataConfig {
    const doc = parse(raw);
    if (doc === null || typeof doc !== "object") {
        throw new Error("invalid sync config: empty document");
    }
    const resolved = resolveEnvRefs(doc, env);
    const parsed = ConfigSchema.safeParse(resolved);
    if (!parsed.success) {
        const detail = parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ");
        throw new Error(`invalid sync config: ${detail}`);
    }
    const names = new Set<string>();
    for (const repo of parsed.data.repositories) {
        if (names.has(repo.name)) {
            throw new Error(
                `invalid sync config: duplicate repo name ${repo.name}`,
            );
        }
        names.add(repo.name);
    }
    return parsed.data;
}

export function loadConfig(
    path: string,
    env: Record<string, string | undefined> = process.env,
): DataConfig {
    let raw: string;
    try {
        raw = readFileSync(path, "utf8");
    } catch (err) {
        throw new Error(`cannot read sync config at ${path}`, { cause: err });
    }
    return parseConfigYaml(raw, env);
}

export function repoByName(
    config: DataConfig,
    name: string,
): RepoConfig | undefined {
    return config.repositories.find((r) => r.name === name);
}

/** GitHub 全名匹配（full_name 大小写不敏感） */
export function repoByGithub(
    config: DataConfig,
    fullName: string,
): RepoConfig | undefined {
    const needle = fullName.toLowerCase();
    return config.repositories.find((r) => r.github.toLowerCase() === needle);
}
