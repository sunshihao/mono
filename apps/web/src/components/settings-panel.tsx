import {
    Badge,
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui";
import { SettingsNav } from "@/components/settings-nav";
import { SkillManager } from "@/components/skill-manager";
import { McpToolManager } from "@/components/mcp-tool-manager";

/**
 * 设置页（首页 tab3）：左侧导航 + 右侧内容区。
 * 分区：技能 / MCP 工具（可配置进工作流）、工作流元素库（参考）、关于（含 MCP 服务说明）。
 */
export function SettingsPanel() {
    return (
        <SettingsNav
            skills={
                <Card>
                    <CardContent className="pt-6">
                        <SkillManager />
                    </CardContent>
                </Card>
            }
            mcpTools={
                <Card>
                    <CardContent className="pt-6">
                        <McpToolManager />
                    </CardContent>
                </Card>
            }
            elements={<ElementsCard />}
            about={
                <>
                    <AboutCard />
                    <McpGuideCard />
                </>
            }
        />
    );
}

/** 关于：工程简介与技术栈 */
function AboutCard() {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">关于 RAG 工作台</CardTitle>
                <CardDescription>
                    自托管的工作流编排与知识库问答工作台：用画布编排 LangGraph
                    工作流，连接向量检索、技能（Skill）与外部 MCP 工具。
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                    <Badge className="border-muted text-muted-foreground">
                        Next.js
                    </Badge>
                    <Badge className="border-muted text-muted-foreground">
                        Hono
                    </Badge>
                    <Badge className="border-muted text-muted-foreground">
                        LangGraph.js
                    </Badge>
                    <Badge className="border-muted text-muted-foreground">
                        LlamaIndexTS
                    </Badge>
                    <Badge className="border-muted text-muted-foreground">
                        Qdrant
                    </Badge>
                    <Badge className="border-muted text-muted-foreground">
                        PostgreSQL
                    </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                    主要能力：知识库问答（text-embedding-v4 嵌入 → Qdrant 检索 →
                    qwen-plus 合成）、可视化工作流编排与多轮 执行、Skill 与 MCP
                    工具注册并接入工作流节点。
                </p>
            </CardContent>
        </Card>
    );
}

/** MCP 服务说明：把知识库作为数据源接入 Claude Code / Claude Desktop */
function McpGuideCard() {
    return (
        <Card className="mt-4">
            <CardHeader>
                <CardTitle className="text-base">
                    对外 MCP 服务：知识库接入 Claude Code / Claude Desktop
                </CardTitle>
                <CardDescription>
                    仓库内置 stdio 模式 MCP Server（<code>apps/mcp</code>
                    ），把知识库作为数据源对外提供 4 个工具。
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                    <Badge className="border-muted text-muted-foreground">
                        search_knowledge · 纯检索上下文
                    </Badge>
                    <Badge className="border-muted text-muted-foreground">
                        rag_query · 知识库问答
                    </Badge>
                    <Badge className="border-muted text-muted-foreground">
                        list_workflows · 工作流列表
                    </Badge>
                    <Badge className="border-muted text-muted-foreground">
                        run_workflow · 执行工作流
                    </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                    先构建 MCP Server，再在 Claude Code
                    中注册（一次即可，长期有效）：
                </p>
                <pre className="overflow-x-auto rounded-lg border bg-muted p-4 text-xs">
                    <code>{`pnpm --filter @repo/mcp build
claude mcp add rag-workbench -- node <mono路径>/apps/mcp/dist/index.js`}</code>
                </pre>
                <p className="text-xs text-muted-foreground">
                    注册后直接提问「用 search_knowledge 检索
                    …」即会调用工具取回知识库上下文；跨机部署时设置{" "}
                    <code>API_URL</code> 指向 API 网关（完整配置见
                    DATA_ACCESS.md ②）。
                </p>
            </CardContent>
        </Card>
    );
}

/** 画布节点元素说明（与 workflow-canvas TYPE_META 语义一致） */
const NODE_ELEMENTS = [
    {
        type: "start",
        name: "开始",
        desc: "工作流入口。一条工作流必须有且只有一个开始节点，流程从它启动。",
    },
    {
        type: "llm",
        name: "LLM",
        desc: "对话节点。把当前上下文交给大模型（qwen-plus）生成回复。",
    },
    {
        type: "retrieve",
        name: "检索",
        desc: "知识库检索节点。对最新用户问题执行 RAG（向量检索 + 合成答案），回答附带来源。",
    },
    {
        type: "skill",
        name: "技能",
        desc: "引用设置页配置的提示词型技能（config.refId），执行时作为 system 指令注入 LLM。",
    },
    {
        type: "mcp",
        name: "MCP",
        desc: "引用设置页注册的外部工具端点（config.refId），执行时调用 HTTP 端点（{query} 替换为问题）。",
    },
    {
        type: "router",
        name: "路由",
        desc: "条件分发。按出边 condition 选择去向——condition 即路由键（运行时取 state.route 或 currentChannel），无匹配时走默认出边。",
    },
    {
        type: "end",
        name: "结束",
        desc: "终点。执行到此结束，返回当前累积的对话状态。",
    },
];

/** 工作流元素库：可编排节点与连线约定参考 */
function ElementsCard() {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">工作流元素库</CardTitle>
                <CardDescription>
                    画布可编排的节点与连线约定——为搭建工作流提供的“设计元素”
                    参考（执行语义见 apps/api 的 langgraph 编译器）。
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <ul className="space-y-3">
                    {NODE_ELEMENTS.map((el) => (
                        <li
                            key={el.type}
                            className="flex items-start gap-3 rounded-md border p-3"
                        >
                            <Badge className="shrink-0 border-muted font-mono text-muted-foreground">
                                {el.type}
                            </Badge>
                            <div className="space-y-1">
                                <p className="text-sm font-medium">{el.name}</p>
                                <p className="text-xs leading-relaxed text-muted-foreground">
                                    {el.desc}
                                </p>
                            </div>
                        </li>
                    ))}
                </ul>
                <p className="text-xs leading-relaxed text-muted-foreground">
                    连线表示执行流转方向：从一个节点指向下一个节点；路由节点
                    （router）的出边可设置 <code>condition</code>{" "}
                    实现条件分支，未设置 condition
                    的出边为默认分支。执行面板支持携带历史消息的多轮运行。
                </p>
            </CardContent>
        </Card>
    );
}
