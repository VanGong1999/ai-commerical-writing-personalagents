"""写作工具与总编工具的中文元数据（供 Agents overview / 详情弹窗）。"""

from __future__ import annotations

from typing import Any

# name(点号或下划线) → 元数据
TOOL_META: dict[str, dict[str, Any]] = {
    "artifact_create": {
        "label": "创建产物",
        "category": "产物管理",
        "description": "在项目中新建一篇产物（梗/大纲/正文/人设等），写入正文 Markdown。",
        "security": "safe",
    },
    "artifact_list": {
        "label": "列出产物",
        "category": "产物管理",
        "description": "按类型筛选当前项目已有产物。",
        "security": "readonly",
    },
    "artifact_update": {
        "label": "更新产物",
        "category": "产物管理",
        "description": "修改已有产物正文或元数据。",
        "security": "safe",
    },
    "diff_artifacts": {
        "label": "产物对比",
        "category": "产物管理",
        "description": "对比两篇产物差异，便于改稿审阅。",
        "security": "readonly",
    },
    "export_doc": {
        "label": "导出文档",
        "category": "产物管理",
        "description": "将产物导出为可下载文档格式。",
        "security": "safe",
    },
    "gate_run": {
        "label": "运行门禁",
        "category": "门禁校验",
        "description": "对当前稿件跑指定 Gate（字数带、钩子、逻辑确认等）。",
        "security": "readonly",
    },
    "done_check": {
        "label": "完成契约检查",
        "category": "门禁校验",
        "description": "对照 Agent 的 DoneContract 判定本轮是否可结束。",
        "security": "readonly",
    },
    "stage_lock": {
        "label": "阶段锁定",
        "category": "门禁校验",
        "description": "确认/推进项目 Stage（需人工 ack 的节点会拦截）。",
        "security": "safe",
    },
    "bible_read": {
        "label": "读圣经",
        "category": "圣经与记忆",
        "description": "读取项目人物/世界观圣经，写正文前强制注入。",
        "security": "readonly",
    },
    "bible_write": {
        "label": "写圣经",
        "category": "圣经与记忆",
        "description": "更新人物或设定圣经条目。",
        "security": "safe",
    },
    "memory_search": {
        "label": "搜索记忆",
        "category": "圣经与记忆",
        "description": "在项目记忆树中检索相关设定与决策。",
        "security": "readonly",
    },
    "memory_read": {
        "label": "读记忆文件",
        "category": "圣经与记忆",
        "description": "读取指定记忆路径全文。",
        "security": "readonly",
    },
    "memory_write": {
        "label": "写记忆文件",
        "category": "圣经与记忆",
        "description": "写入或覆盖记忆文件。",
        "security": "safe",
    },
    "lesson_note": {
        "label": "沉淀私有经验",
        "category": "圣经与记忆",
        "description": "把一条可复用的手法/教训写入该 Agent 自己的私有 lessons（不与其他 Agent 共享）。",
        "security": "safe",
    },
    "payoff_ledger": {
        "label": "伏笔台账",
        "category": "圣经与记忆",
        "description": "查询/更新伏笔埋点与回收状态。",
        "security": "safe",
    },
    "kb_search": {
        "label": "知识库检索",
        "category": "知识库与拆书",
        "description": "检索写作方法知识库文章。",
        "security": "readonly",
    },
    "kb_read": {
        "label": "读知识库文档",
        "category": "知识库与拆书",
        "description": "读取知识库文档正文。",
        "security": "readonly",
    },
    "kb_write_report": {
        "label": "写拆书报告",
        "category": "知识库与拆书",
        "description": "为知识库文档生成某类拆书报告。",
        "security": "safe",
    },
    "web_search": {
        "label": "联网搜索",
        "category": "知识库与拆书",
        "description": "检索公开网页摘要（合规场景）。",
        "security": "readonly",
    },
    "skill_list": {
        "label": "技能目录",
        "category": "技能",
        "description": "列出可用 SKILL 元信息（渐进披露）。",
        "security": "readonly",
    },
    "skill_read": {
        "label": "读取技能书",
        "category": "技能",
        "description": "加载某条 SKILL.md 全文细则。",
        "security": "readonly",
    },
    "tool_search": {
        "label": "搜索工具",
        "category": "工具发现",
        "description": "按关键词发现当前 Agent 可用工具。",
        "security": "readonly",
    },
    "tool_schema_get": {
        "label": "工具 Schema",
        "category": "工具发现",
        "description": "获取工具参数结构。",
        "security": "readonly",
    },
    "tool_invoke": {
        "label": "调用工具",
        "category": "工具发现",
        "description": "按名执行已发现工具。",
        "security": "safe",
    },
    "fs_ls": {
        "label": "列目录",
        "category": "文件系统",
        "description": "列出虚拟文件系统目录。",
        "security": "readonly",
    },
    "fs_read": {
        "label": "读文件",
        "category": "文件系统",
        "description": "读取虚拟文件内容。",
        "security": "readonly",
    },
    "fs_write": {
        "label": "写文件",
        "category": "文件系统",
        "description": "写入虚拟文件（受安全策略限制）。",
        "security": "safe",
    },
    "fs_edit": {
        "label": "编辑文件",
        "category": "文件系统",
        "description": "精确替换文件片段。",
        "security": "safe",
    },
    "fs_grep": {
        "label": "文件搜索",
        "category": "文件系统",
        "description": "在 VFS 中正则搜索。",
        "security": "readonly",
    },
    "fs_find": {
        "label": "查找路径",
        "category": "文件系统",
        "description": "按 glob 查找文件路径。",
        "security": "readonly",
    },
    "job_enqueue": {
        "label": "入队任务",
        "category": "子智能体编排",
        "description": "向后台队列提交新 Job。",
        "security": "safe",
    },
    "job_cancel": {
        "label": "取消任务",
        "category": "子智能体编排",
        "description": "请求取消运行中的 Job。",
        "security": "safe",
    },
    "subagent_spawn": {
        "label": "生成子智能体",
        "category": "子智能体编排",
        "description": "同步派生 scout/planner/worker/reviewer 子任务。",
        "security": "safe",
    },
    "project_get": {
        "label": "读项目",
        "category": "产物管理",
        "description": "读取项目元数据与当前阶段。",
        "security": "readonly",
    },
    "usage_log": {
        "label": "用量记录",
        "category": "门禁校验",
        "description": "记录本轮 Token 用量。",
        "security": "readonly",
    },
    "scan_banned_phrases": {
        "label": "禁词扫描",
        "category": "启发式体检",
        "description": "扫描 AI 套话与禁用比喻。",
        "security": "readonly",
    },
    "scan_length": {
        "label": "字数扫描",
        "category": "启发式体检",
        "description": "检查字数是否在规格带内。",
        "security": "readonly",
    },
    # 总编工具
    "start_async_task": {
        "label": "启动异步任务",
        "category": "总编调度",
        "description": "启动单 Agent 或跨书/多章编排矩阵，立即返回任务组 ID。",
        "security": "safe",
    },
    "check_async_task": {
        "label": "查询异步任务",
        "category": "总编调度",
        "description": "查询 run 或任务组进度百分比与待审批节点。",
        "security": "readonly",
    },
    "update_async_task": {
        "label": "更新异步任务",
        "category": "总编调度",
        "description": "enqueue 追加指令或 interrupt 硬中断重跑。",
        "security": "safe",
    },
    "cancel_async_task": {
        "label": "取消异步任务",
        "category": "总编调度",
        "description": "取消单个 run 或整个任务组。",
        "security": "safe",
    },
    "list_async_tasks": {
        "label": "列出异步任务",
        "category": "总编调度",
        "description": "列出会话/全局活跃与待审批任务树。",
        "security": "readonly",
    },
    "run_agent": {
        "label": "运行创作 Agent",
        "category": "总编调度",
        "description": "在项目异步入队一个领域 Agent。",
        "security": "safe",
    },
    "create_fleet": {
        "label": "创建 Fleet",
        "category": "总编调度",
        "description": "单项目内多智能体批量编排（需确认）。",
        "security": "safe",
    },
    "steer_agent": {
        "label": "追加指令",
        "category": "总编调度",
        "description": "向运行中子 Agent 直通 steer 信箱。",
        "security": "safe",
    },
    "plan": {
        "label": "规划阶段",
        "category": "总编调度",
        "description": "为 team 任务产出分阶段计划。",
        "security": "readonly",
    },
    "search_agents": {
        "label": "检索 Agent",
        "category": "总编调度",
        "description": "按关键词检索创作 Agent 目录。",
        "security": "readonly",
    },
    "search_tools": {
        "label": "检索工具",
        "category": "总编调度",
        "description": "发现总编可用工具名。",
        "security": "readonly",
    },
    "follow_up": {
        "label": "跟进闹钟",
        "category": "总编调度",
        "description": "到期后唤醒总编继续处理。",
        "security": "safe",
    },
}


def normalize_tool_name(name: str) -> str:
    return str(name or "").strip()


def lookup_tool(name: str) -> dict[str, Any]:
    raw = normalize_tool_name(name)
    meta = TOOL_META.get(raw) or TOOL_META.get(raw.replace("_", ".")) or TOOL_META.get(raw.replace(".", "_"))
    if meta:
        return {"id": raw, **meta}
    # 启发式分类
    cat = "其他"
    if raw.startswith("artifact") or raw.startswith("export"):
        cat = "产物管理"
    elif raw.startswith("gate") or raw.startswith("done") or raw.startswith("stage"):
        cat = "门禁校验"
    elif raw.startswith("bible") or raw.startswith("memory") or "payoff" in raw:
        cat = "圣经与记忆"
    elif raw.startswith("kb") or raw.startswith("web"):
        cat = "知识库与拆书"
    elif raw.startswith("skill"):
        cat = "技能"
    elif raw.startswith("tool_"):
        cat = "工具发现"
    elif raw.startswith("fs_") or raw.startswith("fs."):
        cat = "文件系统"
    elif raw.startswith("scan") or raw.startswith("trope") or "validate" in raw:
        cat = "启发式体检"
    elif raw.startswith("job") or "subagent" in raw or "fleet" in raw or "async" in raw:
        cat = "子智能体编排"
    return {
        "id": raw,
        "label": raw,
        "category": cat,
        "description": f"工具 {raw}",
        "security": "safe",
    }


def tools_catalog_for(names: list[str] | None = None) -> list[dict[str, Any]]:
    if names:
        return [lookup_tool(n) for n in names]
    # 全量已知 + 去重
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for k in TOOL_META:
        item = lookup_tool(k)
        if item["id"] in seen:
            continue
        seen.add(item["id"])
        out.append(item)
    return out
