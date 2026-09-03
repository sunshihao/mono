"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button } from "@/components/ui";

/** 新建工作流：POST 最小 start→end 图 → 跳转编辑页 */
export function NewWorkflowButton() {
    const router = useRouter();
    const [creating, setCreating] = useState(false);

    const create = async () => {
        setCreating(true);
        try {
            const res = await api.v1.workflows.$post({
                json: {
                    name: "未命名工作流",
                    graph: {
                        nodes: [
                            { id: "start", type: "start", config: {} },
                            { id: "end", type: "end", config: {} },
                        ],
                        edges: [{ id: "e1", source: "start", target: "end" }],
                    },
                },
            });
            if (!res.ok) return;
            const dto = await res.json();
            router.push(`/workflows/${dto.id}`);
        } finally {
            setCreating(false);
        }
    };

    return (
        <Button onClick={() => void create()} disabled={creating}>
            {creating ? "创建中…" : "新建工作流"}
        </Button>
    );
}
