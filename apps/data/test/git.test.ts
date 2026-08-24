import { execFile } from "node:child_process";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { createGitOps, EMPTY_TREE_SHA } from "../src/git.js";

/**
 * git 模块离线测试：本地 bare 仓库充当远端（file://），
 * 覆盖 diff A/M/D/R、空树 backfill、isAncestor、lsRemote、showFile。
 */
const execFileAsync = promisify(execFile);
const gitOps = createGitOps();

async function run(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("git", ["-C", cwd, ...args]);
    return stdout.trim();
}

let repo: string;
let remote: string;
let sha1: string; // c1: a.md + b.md
let sha2: string; // c2: M a.md, A c.md, D b.md
let sha3: string; // c3: R c.md -> d.md（纯重命名）

beforeAll(async () => {
    const base = await mkdtemp(join(tmpdir(), "data-git-"));
    remote = join(base, "remote.git");
    repo = join(base, "work");
    await run(base, ["init", "--bare", "remote.git"]);
    await run(base, ["init", "--initial-branch=main", "work"]);
    await run(repo, ["config", "user.email", "test@example.com"]);
    await run(repo, ["config", "user.name", "test"]);
    await run(repo, ["remote", "add", "origin", remote]);

    await writeFile(join(repo, "a.md"), "# Title\n\nhello world\n");
    await writeFile(join(repo, "b.md"), "second file\n");
    await run(repo, ["add", "."]);
    await run(repo, ["commit", "-m", "c1"]);
    sha1 = await run(repo, ["rev-parse", "HEAD"]);

    await writeFile(join(repo, "a.md"), "# Title\n\nhello world v2\n");
    await rm(join(repo, "b.md"));
    await writeFile(join(repo, "c.md"), "third file\n");
    await run(repo, ["add", "-A"]);
    await run(repo, ["commit", "-m", "c2"]);
    sha2 = await run(repo, ["rev-parse", "HEAD"]);

    await rename(join(repo, "c.md"), join(repo, "d.md"));
    await run(repo, ["add", "-A"]);
    await run(repo, ["commit", "-m", "c3"]);
    sha3 = await run(repo, ["rev-parse", "HEAD"]);

    await run(repo, ["push", "--all", "origin"]);
});

describe("createGitOps", () => {
    it("diffNameStatus：A/M/D 齐全（sha1 → sha2）", async () => {
        const changes = await gitOps.diffNameStatus(repo, sha1, sha2);
        const byPath = new Map(
            changes.map((c) => [c.newPath ?? c.oldPath, c]),
        );
        expect(byPath.get("a.md")).toMatchObject({
            status: "M",
            oldPath: "a.md",
            newPath: "a.md",
        });
        expect(byPath.get("c.md")).toMatchObject({
            status: "A",
            oldPath: null,
            newPath: "c.md",
        });
        expect(byPath.get("b.md")).toMatchObject({
            status: "D",
            oldPath: "b.md",
            newPath: null,
        });
    });

    it("diffNameStatus：纯重命名检出 R（sha2 → sha3）", async () => {
        const changes = await gitOps.diffNameStatus(repo, sha2, sha3);
        expect(changes).toHaveLength(1);
        expect(changes[0]).toMatchObject({
            status: "R",
            oldPath: "c.md",
            newPath: "d.md",
        });
    });

    it("空树 diff = 全量 backfill（仅含目标树存在的文件）", async () => {
        const changes = await gitOps.diffNameStatus(repo, EMPTY_TREE_SHA, sha3);
        const paths = changes.map((c) => c.newPath).sort();
        expect(paths).toEqual(["a.md", "d.md"]); // b.md 已删、c.md 已改名
        expect(changes.every((c) => c.status === "A")).toBe(true);
    });

    it("showFile：读取指定 commit 的文件内容", async () => {
        const buf = await gitOps.showFile(repo, sha1, "a.md");
        expect(buf.toString("utf8")).toContain("hello world\n");
    });

    it("showFile：目标 sha 下已删除的文件抛错", async () => {
        await expect(gitOps.showFile(repo, sha3, "b.md")).rejects.toThrow();
    });

    it("isAncestor：祖先判断", async () => {
        expect(await gitOps.isAncestor(repo, sha1, sha3)).toBe(true);
        expect(await gitOps.isAncestor(repo, sha3, sha1)).toBe(false);
    });

    it("lsRemote：取远端分支头", async () => {
        expect(await gitOps.lsRemote(repo, "origin", "main")).toBe(sha3);
    });

    it("ensureRepo：非仓库目录抛错", async () => {
        const notRepo = await mkdtemp(join(tmpdir(), "data-notgit-"));
        await expect(gitOps.ensureRepo(notRepo)).rejects.toThrow(/not a git repo/);
        await expect(gitOps.ensureRepo(repo)).resolves.toBeUndefined();
    });

    it("fetch：静默成功（无对象变化）", async () => {
        await expect(gitOps.fetch(repo, "origin", "main")).resolves.toBeUndefined();
    });
});
