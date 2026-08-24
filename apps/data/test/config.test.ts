import { describe, expect, it } from "vitest";
import { parseConfigYaml } from "../src/config.js";

const BASE = `
version: 1
vector_store:
  provider: qdrant
  url: env:QDRANT_URL
  api_key: env:QDRANT_API_KEY
embedding:
  provider: dashscope
  model: text-embedding-v4
  dimensions: 1024
  batch_size: 16
  api_key: env:OPENAI_API_KEY
repositories:
  - name: r1
    github: org/r1
    local_path: repos/r1
    branch: main
    collection: r1-main
    include: ["**/*.md"]
    chunking:
      strategy: auto
      chunk_size: 800
      overlap: 100
`;

const ENV = {
    QDRANT_URL: "http://qdrant:6333",
    QDRANT_API_KEY: "tok",
    OPENAI_API_KEY: "sk-1",
};

describe("parseConfigYaml", () => {
    it("解析合法配置并注入 env 引用", () => {
        const config = parseConfigYaml(BASE, ENV);
        expect(config.version).toBe(1);
        expect(config.vector_store.url).toBe("http://qdrant:6333");
        expect(config.vector_store.api_key).toBe("tok");
        expect(config.embedding.api_key).toBe("sk-1");
        expect(config.repositories).toHaveLength(1);
        const repo = config.repositories[0]!;
        expect(repo.name).toBe("r1");
        expect(repo.chunking.strategy).toBe("auto");
        expect(repo.chunking.chunk_size).toBe(800);
    });

    it("必需 env 缺失 → 报错并指明变量名", () => {
        expect(() => parseConfigYaml(BASE, { QDRANT_URL: "http://x:1" })).toThrow(
            /QDRANT_API_KEY is not set/,
        );
    });

    it("webhook_secret_ref 的 env 缺失 → 省略该字段（不阻塞配置加载）", () => {
        const withSecret = BASE + "    webhook_secret_ref: env:GH_SECRET_R1\n";
        const config = parseConfigYaml(withSecret, ENV);
        expect(config.repositories[0]!.webhook_secret_ref).toBeUndefined();
        const withValue = parseConfigYaml(withSecret, {
            ...ENV,
            GH_SECRET_R1: "s3cret",
        });
        expect(withValue.repositories[0]!.webhook_secret_ref).toBe("s3cret");
    });

    it("env:VAR 笔误（小写名）残留字面量 → url 校验兜底报错", () => {
        const bad = BASE.replace("url: env:QDRANT_URL", "url: env:qdrant_url");
        expect(() => parseConfigYaml(bad, ENV)).toThrow(/vector_store.url/);
    });

    it("重复仓库名 → 报错", () => {
        const dup = BASE + `
  - name: r1
    github: org/r2
    local_path: repos/r2
    collection: r2-main
`;
        expect(() => parseConfigYaml(dup, ENV)).toThrow(/duplicate repo name r1/);
    });

    it("非法 collection 名 → 报错", () => {
        const bad = BASE.replace("collection: r1-main", "collection: R1 Main");
        expect(() => parseConfigYaml(bad, ENV)).toThrow(/collection/);
    });

    it("非法 github 名（非 org/repo）→ 报错", () => {
        const bad = BASE.replace("github: org/r1", "github: no-slash");
        expect(() => parseConfigYaml(bad, ENV)).toThrow(/github/);
    });

    it("缺省字段走默认值（branch/main、include、exclude、chunking）", () => {
        const minimal = `
version: 1
vector_store:
  provider: qdrant
  url: http://qdrant:6333
embedding: {}
repositories:
  - name: r1
    github: org/r1
    local_path: repos/r1
    collection: r1-main
`;
        const config = parseConfigYaml(minimal);
        expect(config.repositories[0]!.branch).toBe("main");
        expect(config.repositories[0]!.include).toEqual(["**/*"]);
        expect(config.repositories[0]!.exclude).toEqual([]);
        expect(config.repositories[0]!.chunking.strategy).toBe("auto");
        expect(config.embedding.provider).toBe("dashscope");
        expect(config.embedding.dimensions).toBe(1024);
    });

    it("空文档 → 报错", () => {
        expect(() => parseConfigYaml("# only comment")).toThrow(/empty/);
    });
});
