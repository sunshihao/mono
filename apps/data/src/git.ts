import { execFile } from "node:child_process";
import { promisify } from "node:util";

/**
 * git 操作封装（设计 §6：diff 驱动增量）。
 * 全部走子进程 execFile（无 shell 注入面）；管线只读远端对象
 * （cat-file 取指定 commit 下的文件内容），不依赖工作区状态，
 * 因此子仓库工作区即使有本地改动/未提交内容也不影响同步。
 */

const execFileAsync = promisify(execFile);

/** git 空树 sha：diff <empty> <target> = 该 commit 下的全量文件（统一全量/增量逻辑） */
export const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
/** GitHub 分支删除事件的 after 值 */
export const ZERO_SHA = "0000000000000000000000000000000000000000";

export interface FileChange {
    /** A/M/D/R（R 含相似度分数，仅取首字符） */
    status: "A" | "M" | "D" | "R";
    oldPath: string | null;
    newPath: string | null;
}

export interface GitOps {
    /** 校验目录是 git 仓库，否则抛出带路径的明确错误 */
    ensureRepo(repoPath: string): Promise<void>;
    fetch(repoPath: string, remote: string, branch: string): Promise<void>;
    /** 远端分支头 sha（reconcile / 无 target 时的默认目标） */
    lsRemote(repoPath: string, remote: string, branch: string): Promise<string>;
    /** git diff --name-status -z 解析出文件变更集 */
    diffNameStatus(repoPath: string, from: string, to: string): Promise<FileChange[]>;
    /** 指定 commit 下文件内容（原始字节，调用方做二进制检测） */
    showFile(repoPath: string, sha: string, filePath: string): Promise<Buffer>;
    /** maybeAncestor 是否是 sha 的祖先（退出码语义） */
    isAncestor(repoPath: string, maybeAncestor: string, sha: string): Promise<boolean>;
}

interface GitExecOptions {
    encoding?: BufferEncoding | "buffer";
    maxBuffer?: number;
    timeout?: number;
}

async function git(
    repoPath: string,
    args: string[],
    options: GitExecOptions = {},
): Promise<string | Buffer> {
    const {
        encoding = "utf8",
        maxBuffer = 64 * 1024 * 1024,
        timeout = 120_000,
    } = options;
    const { stdout } = await execFileAsync("git", ["-C", repoPath, ...args], {
        encoding: encoding === "buffer" ? "buffer" : encoding,
        maxBuffer,
        timeout,
    });
    return stdout;
}

const SHA40 = /^[0-9a-f]{40}$/;

export function createGitOps(): GitOps {
    return {
        async ensureRepo(repoPath) {
            try {
                await git(repoPath, ["rev-parse", "--git-dir"], { timeout: 10_000 });
            } catch {
                throw new Error(
                    `local repo missing or not a git repo: ${repoPath}`,
                );
            }
        },

        async fetch(repoPath, remote, branch) {
            await git(repoPath, ["fetch", "--quiet", remote, branch], {
                timeout: 300_000,
            });
        },

        async lsRemote(repoPath, remote, branch) {
            const out = (await git(repoPath, [
                "ls-remote",
                remote,
                `refs/heads/${branch}`,
            ], { timeout: 60_000 })) as string;
            const sha = out.split(/\s+/)[0];
            if (!sha || !SHA40.test(sha)) {
                throw new Error(
                    `cannot resolve remote head ${remote} refs/heads/${branch} in ${repoPath}`,
                );
            }
            return sha;
        },

        async diffNameStatus(repoPath, from, to) {
            // -z：NUL 分隔机器可解析；--find-renames：R100 old new 三元组
            const out = (await git(repoPath, [
                "diff",
                "--name-status",
                "-z",
                "--find-renames",
                "--no-ext-diff",
                from,
                to,
                "--",
            ])) as string;
            const tokens = out.split("\0").filter((t) => t.length > 0);
            const changes: FileChange[] = [];
            let i = 0;
            while (i < tokens.length) {
                const head = tokens[i]!;
                const status = head[0]!;
                if (status === "R") {
                    changes.push({
                        status: "R",
                        oldPath: tokens[i + 1] ?? null,
                        newPath: tokens[i + 2] ?? null,
                    });
                    i += 3;
                } else if (status === "A" || status === "M" || status === "D") {
                    const path = tokens[i + 1] ?? null;
                    changes.push({
                        status,
                        oldPath: status === "A" ? null : path,
                        newPath: status === "D" ? null : path,
                    });
                    i += 2;
                } else {
                    i += 1; // 未知状态码：防御性跳过
                }
            }
            return changes;
        },

        async showFile(repoPath, sha, filePath) {
            return (await git(repoPath, ["cat-file", "blob", `${sha}:${filePath}`], {
                encoding: "buffer",
            })) as Buffer;
        },

        async isAncestor(repoPath, maybeAncestor, sha) {
            try {
                await git(repoPath, [
                    "merge-base",
                    "--is-ancestor",
                    maybeAncestor,
                    sha,
                ], { timeout: 60_000 });
                return true;
            } catch {
                return false; // 非祖先 / 对象缺失 → false
            }
        },
    };
}
