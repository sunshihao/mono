"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Button, Dialog, DialogActions, DialogTitle } from "@/components/ui";

/**
 * 删除工作流（确认弹窗 + 唯一一处删除逻辑）—— 详情页头部与列表卡片共用。
 *
 * 落点用可序列化的 props 表达而非回调：两个调用点都是 server component，
 * 函数 prop 过不了 RSC 边界（传不进去，也无法在服务端序列化）。
 *
 * 行为约定：
 * - 先弹确认框；请求期间两个按钮 disabled、「删除中…」，且 Escape / 点遮罩 / 取消一并冻结
 *   —— 请求已发出，半途取消只会造成"看着没删其实删了"；
 * - 204 = 成功；404 = 已被别处删除，目标状态已达成，同样按成功处理；
 *   其余（503 / 5xx / 网络错误）在弹窗内联展示，弹窗保持打开可重试；
 * - 成功路径绝不调用 res.json() —— 后端成功时返回 204，没有响应体。
 */
export interface DeleteWorkflowButtonProps {
    id: string;
    name: string;
    /**
     * 触发按钮形态：
     * - "outline"（默认）：详情页头部 —— 描边 + 危险色文字，与 h1 同级；
     * - "icon"：列表卡片右上角 —— ghost 小方钮（✕）。
     */
    variant?: "outline" | "icon";
    /**
     * 删除成功后的落点（服务端组件不能传函数，故用可序列化路径表达）：
     * - 传路径（详情页传 "/"）→ router.replace(path) + router.refresh()
     *   （用 replace 而非 push：原路由已失效，避免 Back 回到已删除的详情页）；
     * - 不传（列表页）→ 仅 router.refresh()，服务端组件原地重渲染，卡片自动消失。
     */
    redirectTo?: string;
    className?: string;
}

export function DeleteWorkflowButton({
    id,
    name,
    variant = "outline",
    redirectTo,
    className,
}: DeleteWorkflowButtonProps) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    function handleOpenChange(next: boolean) {
        if (!next && deleting) return; // 删除进行中：禁止 Esc / 点遮罩 / 取消关闭
        if (next) setError(null);
        setOpen(next);
    }

    async function remove() {
        if (deleting) return; // disabled 之外的兜底（Enter 长按重复触发）
        setDeleting(true);
        setError(null);

        let ok = false;
        try {
            const res = await api.v1.workflows[":id"].$delete({
                param: { id },
            });
            if (res.ok || res.status === 404) {
                // 404 视为成功：目标状态（库中无此工作流）已达成
                ok = true;
            } else if (res.status === 503) {
                setError("数据库未配置，无法删除（db 插件 disabled）");
            } else {
                setError(`删除失败（HTTP ${res.status}）`);
            }
        } catch {
            setError("删除失败（网络错误）");
        }

        if (!ok) {
            setDeleting(false);
            return;
        }

        setOpen(false);
        if (redirectTo) router.replace(redirectTo);
        // refresh() 是必需而非装饰：目标路由很可能还在 client Router Cache 里，
        // 不刷新会看到已删除的卡片（先例见 components/user-menu.tsx）。
        router.refresh();
    }

    return (
        <>
            {variant === "icon" ? (
                <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`删除工作流 ${name}`}
                    title="删除"
                    className={cn(
                        " text-muted-foreground hover:bg-base-200 hover:text-destructive",
                        className,
                    )}
                    onClick={() => handleOpenChange(true)}
                >
                    ✕
                </Button>
            ) : (
                <Button
                    variant="outline"
                    className={cn(
                        "text-destructive hover:bg-destructive/10",
                        className,
                    )}
                    onClick={() => handleOpenChange(true)}
                >
                    删除
                </Button>
            )}

            <Dialog open={open} onOpenChange={handleOpenChange}>
                <DialogTitle>删除工作流「{name}」？</DialogTitle>
                <p className="pt-2 text-sm text-muted-foreground">
                    删除后不可恢复，该工作流的全部版本历史也会一并删除。
                </p>
                {error && (
                    <p className="pt-2 text-sm text-destructive">{error}</p>
                )}
                <DialogActions>
                    {/* 取消排在删除之前：DOM 顺序 = 视觉顺序，初始焦点落在安全动作上 */}
                    <Button
                        variant="outline"
                        disabled={deleting}
                        onClick={() => handleOpenChange(false)}
                    >
                        取消
                    </Button>
                    <Button
                        variant="destructive"
                        disabled={deleting}
                        onClick={() => void remove()}
                    >
                        {deleting ? "删除中…" : "删除"}
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
}
