import { toolOperationEffect } from "@xiezuomanju/agent-runtime";
import { normalizeToolName } from "./toolNames.js";

/**
 * 写作工具统一目录：category / keywords / tier / risk。
 * 单一事实来源，供 tool_search、系统提示类别索引、一致性单测使用。
 */

/** @typedef {"core"|"agent"|"deferred"} ToolTier */
/** @typedef {"read"|"write"|"meta"} ToolRisk */

/**
 * @typedef {Object} ToolCatalogEntry
 * @property {string} name
 * @property {string} category
 * @property {string[]} keywords
 * @property {string} [description]
 * @property {ToolTier} [defaultTier] 仅 meta/core 有固定 tier；其余按 Agent allowlist
 * @property {ToolRisk} risk
 * @property {boolean} [alwaysAllow] 写类但范围被工具自身固定（如私有 lessons），无需 allowlist
 */

/** @type {ToolCatalogEntry[]} */
export const TOOL_CATALOG = [
  // —— meta / core ——
  {
    name: "tool_search",
    category: "meta",
    keywords: ["搜索工具", "发现工具", "找工具", "search tools"],
    defaultTier: "core",
    risk: "meta",
  },
  {
    name: "tool_schema_get",
    category: "meta",
    keywords: ["工具参数", "schema", "参数说明"],
    defaultTier: "deferred",
    risk: "meta",
  },
  {
    name: "tool_invoke",
    category: "meta",
    keywords: ["调用工具", "invoke"],
    defaultTier: "deferred",
    risk: "meta",
  },
  {
    name: "skill_list",
    category: "meta",
    keywords: ["技能列表", "skills"],
    defaultTier: "deferred",
    risk: "meta",
  },
  {
    name: "skill_read",
    category: "meta",
    keywords: ["读技能", "SKILL", "技能正文", "progressive"],
    defaultTier: "core",
    risk: "meta",
  },
  {
    name: "done_check",
    category: "质检",
    keywords: ["完成检查", "Done Contract", "收尾", "门禁汇总"],
    defaultTier: "core",
    risk: "read",
  },
  {
    name: "gate_run",
    category: "质检",
    keywords: ["门禁", "LengthBand", "HookPresence", "Format", "Gate"],
    defaultTier: "core",
    risk: "read",
  },
  {
    name: "artifact_create",
    category: "产物",
    keywords: ["创建产物", "交付", "候选", "artifact"],
    defaultTier: "core",
    risk: "write",
  },
  {
    name: "artifact_list",
    category: "产物",
    keywords: ["产物列表", "列产物"],
    defaultTier: "core",
    risk: "read",
  },
  {
    name: "bible_read",
    category: "圣经",
    keywords: ["读圣经", "bible", "设定", "人物小传"],
    defaultTier: "core",
    risk: "read",
  },
  {
    name: "memory_search",
    category: "记忆",
    keywords: ["项目记忆", "搜记忆", "memory search", "回忆"],
    defaultTier: "core",
    risk: "read",
  },

  // —— 产物 ——
  {
    name: "artifact_update",
    category: "产物",
    keywords: ["更新产物", "改产物"],
    risk: "write",
  },
  {
    name: "project_get",
    category: "产物",
    keywords: ["项目信息", "project"],
    risk: "read",
  },
  {
    name: "diff_artifacts",
    category: "产物",
    keywords: ["产物对比", "diff"],
    risk: "read",
  },
  {
    name: "export_doc",
    category: "产物",
    keywords: ["导出", "文档", "export"],
    risk: "write",
  },
  {
    name: "usage_log",
    category: "产物",
    keywords: ["用量", "usage", "token"],
    risk: "write",
  },
  {
    name: "job_enqueue",
    category: "产物",
    keywords: ["入队", "enqueue", "调度"],
    risk: "write",
  },
  {
    name: "job_cancel",
    category: "产物",
    keywords: ["取消任务", "cancel job"],
    risk: "write",
  },
  {
    name: "subagent_spawn",
    category: "产物",
    keywords: ["子代理", "subagent", "spawn"],
    risk: "write",
  },
  {
    name: "stage_lock",
    category: "产物",
    keywords: ["阶段锁", "stage lock"],
    risk: "write",
  },
  {
    name: "table_write",
    category: "产物",
    keywords: ["写表", "table"],
    risk: "write",
  },
  {
    name: "ontology_action",
    category: "产物",
    keywords: ["提交本体", "UpsertObject", "写本体", "本体动作", "ontology action"],
    defaultTier: "deferred",
    risk: "write",
  },
  {
    name: "ontology_query",
    category: "产物",
    keywords: ["本体查询", "objectSet", "searchAround", "sliceForBible", "ontology query"],
    defaultTier: "deferred",
    risk: "read",
  },

  // —— 圣经 / 记忆 ——
  {
    name: "bible_write",
    category: "圣经",
    keywords: ["写圣经", "更新设定", "bible write"],
    risk: "write",
  },
  {
    name: "memory_get",
    category: "记忆",
    keywords: ["读记忆", "memory get"],
    risk: "read",
  },
  {
    name: "memory_list",
    category: "记忆",
    keywords: ["记忆列表", "list memories"],
    risk: "read",
  },
  {
    name: "memory_write",
    category: "记忆",
    keywords: ["写记忆", "memory write"],
    risk: "write",
  },
  {
    name: "lesson_note",
    category: "记忆",
    keywords: ["经验", "教训", "lesson", "私有记忆", "沉淀"],
    risk: "write",
    // 只写自己的私有 lessons 文件（路径由 worker 固定，不接受外部 path）→ 所有 Agent 可调
    alwaysAllow: true,
  },
  {
    name: "memory_merge",
    category: "记忆",
    keywords: ["合并记忆", "memory merge"],
    risk: "write",
  },
  {
    name: "memory_grep",
    category: "记忆",
    keywords: ["记忆检索", "grep memory"],
    risk: "read",
  },
  {
    name: "memory_freeze",
    category: "记忆",
    keywords: ["冻结记忆", "freeze"],
    risk: "write",
  },

  // —— 知识库 ——
  {
    name: "kb_search",
    category: "知识库",
    keywords: ["搜知识库", "kb", "资料", "上传文稿", "桥段", "方法论", "documents", "tropes"],
    risk: "read",
  },
  {
    name: "kb_read",
    category: "知识库",
    keywords: ["读知识库文档", "kb read"],
    risk: "read",
  },
  {
    name: "kb_write_report",
    category: "知识库",
    keywords: ["写知识报告", "kb report"],
    risk: "write",
  },
  {
    name: "web_search",
    category: "知识库",
    keywords: ["热点", "网页搜索", "联网", "web"],
    risk: "read",
  },
  {
    name: "checklist_open",
    category: "知识库",
    keywords: ["清单", "checklist"],
    risk: "read",
  },

  // —— 选题 ——
  {
    name: "want_how_concretize",
    category: "选题",
    keywords: ["想怎样通过啥", "选题", "want how", "查理", "爽点壳"],
    risk: "read",
  },
  {
    name: "cool_stack_score",
    category: "选题",
    keywords: ["爽点叠分", "五大爽点", "cool stack"],
    description:
      "对原样节拍文本做固定关键词匹配，仅供辅助。零命中表示未匹配到词，实际爽点仍需结合情节判断。结果不评估叙事质量或市场表现。window 只影响堆叠提示的最少节拍数，命中数和密度与它无关。相同情节无需重测，按岗位要求直接交付。",
    risk: "read",
  },
  {
    name: "trope_coverage",
    category: "选题",
    keywords: ["套路覆盖", "题材", "trope", "curve"],
    risk: "read",
  },
  {
    name: "option_enumerate",
    category: "选题",
    keywords: ["方案枚举", "选项", "enumerate"],
    risk: "read",
  },
  {
    name: "spec_pitch_validate",
    description: "meetsSpec 检查导语是否填写、小传及大纲数量，另列建议字数；提交依实际合同。",
    category: "选题",
    keywords: ["规格校验", "pitch", "投稿规格"],
    risk: "read",
  },
  {
    name: "clip_candidate_extract",
    category: "选题",
    keywords: ["切片候选", "clip", "对标"],
    risk: "read",
  },

  // —— 人物 ——
  {
    name: "witness_suggest",
    category: "人物",
    keywords: ["见证人", "旁观者", "witness"],
    risk: "read",
  },
  {
    name: "voice_diversity_score",
    description: "maxOverlap 测量样本字面重叠，可结合台词语境复核。",
    category: "人物",
    keywords: ["声线多样性", "人设声线", "voice"],
    risk: "read",
  },
  {
    name: "info_asymmetry_tag",
    category: "人物",
    keywords: ["信息差", "信息不对称"],
    risk: "read",
  },
  {
    name: "ner_realworld",
    description: "hits 列出词表命中，是否涉及真实对象需结合语境复核。",
    category: "人物",
    keywords: ["真人名", "NER", "敏感实体"],
    risk: "read",
  },

  // —— 结构 ——
  {
    name: "beat20_scaffold",
    category: "结构",
    keywords: ["20节拍", "节拍表", "beat20", "查理结构"],
    risk: "read",
  },
  {
    name: "midpoint_locator",
    category: "结构",
    keywords: ["中点", "midpoint"],
    risk: "read",
  },
  {
    name: "paywall_slots",
    category: "结构",
    keywords: ["付费卡点", "充值点", "paywall"],
    risk: "read",
  },
  {
    name: "payoff_ledger",
    category: "结构",
    keywords: ["伏笔账本", "兑现", "payoff", "期待"],
    risk: "read",
  },
  {
    name: "suspense_budget_check",
    description: "withinBudget 比较开放伏笔数与预算，超出时可结合回收计划复核。",
    category: "结构",
    keywords: ["悬念预算", "悬念", "suspense"],
    risk: "read",
  },
  {
    name: "outline_table",
    category: "结构",
    keywords: ["大纲表", "outline"],
    risk: "read",
  },
  {
    name: "exchange_chain_step",
    category: "结构",
    keywords: ["交换链", "推进", "exchange"],
    risk: "read",
  },
  {
    name: "one_plus_one_suggest",
    description: "pairs 给出伏笔配对，meetsExerciseTarget 仅表示是否达到练习目标。",
    category: "结构",
    keywords: ["1+1", "叠加", "九格"],
    risk: "read",
  },
  {
    name: "hook_100word_check",
    description: "lengthWithinRange 检查指定字数范围，关键词仅作提示，人工批准另行确认。",
    category: "结构",
    keywords: ["百字钩子", "开篇钩子", "hook"],
    risk: "read",
  },

  // —— 分场 ——
  {
    name: "scene_triple_validate",
    category: "分场",
    keywords: ["场景三要素", "信息推进变化", "scene triple"],
    risk: "read",
  },
  {
    name: "format_scene_header",
    category: "分场",
    keywords: ["场景头", "scene header"],
    risk: "read",
  },
  {
    name: "same_loc_task_change_check",
    description: "同地点同目标仅记入 warns，可结合新增信息复核。",
    category: "分场",
    keywords: ["同场景任务变", "location task"],
    risk: "read",
  },
  {
    name: "location_merge_suggest",
    category: "分场",
    keywords: ["场景合并", "location merge", "≤3场景"],
    risk: "read",
  },

  // —— 台词 ——
  {
    name: "speak_aloud_lint",
    description: "可选朗读建议：列出句长和逗号线索。",
    category: "台词",
    keywords: ["可选朗读建议", "朗读检查", "台词", "speak aloud"],
    risk: "read",
  },
  {
    name: "speak_aloud_hint",
    description: "可选朗读建议：列出句长和逗号线索。",
    category: "台词",
    keywords: ["朗读提示", "台词提示"],
    risk: "read",
  },
  {
    name: "line_split_attitude_info_subtext",
    category: "台词",
    keywords: ["态度信息潜台词", "台词拆分", "subtext"],
    risk: "read",
  },
  {
    name: "ab_pingpong_detect",
    category: "台词",
    keywords: ["轮流问答", "机械轮替", "AB乒乓", "对白乒乓", "pingpong"],
    risk: "read",
  },
  {
    name: "finger_simplify",
    category: "台词",
    keywords: ["手指简化", "动作简化", "finger"],
    risk: "read",
  },

  // —— 提示词 ——
  {
    name: "prompt_render",
    category: "提示词",
    keywords: ["渲染提示词", "prompt render"],
    risk: "read",
  },
  {
    name: "prompt_validate_lock",
    category: "提示词",
    keywords: ["提示词锁", "validate lock"],
    risk: "read",
  },
  {
    name: "prompt_4part_build",
    category: "提示词",
    keywords: ["四段式", "指令四段", "查理AI"],
    risk: "read",
  },
  {
    name: "lapi_checklist",
    category: "提示词",
    keywords: ["LAPI清单", "checklist"],
    risk: "read",
  },

  // —— 质检 ——
  {
    name: "scan_banned_phrases",
    category: "质检",
    keywords: ["禁词", "AI味", "banned", "去AI味"],
    risk: "read",
  },
  {
    name: "scan_length",
    category: "质检",
    keywords: ["字数扫描", "长度", "LengthBand"],
    risk: "read",
  },
  {
    name: "scan_hook_present",
    category: "质检",
    keywords: ["钩子检测", "HookPresence", "开篇钩"],
    risk: "read",
  },
  {
    name: "regex_redline",
    description: "可选语境风险提示：词语匹配不能确认违规或批准发布。",
    category: "质检",
    keywords: ["红线", "正则", "redline"],
    risk: "read",
  },
  {
    name: "decay_detect",
    category: "质检",
    description: "根据输入字数提供诊断；正式门禁核验已保存正文，后续作业由批次调度。",
    keywords: ["字数衰减", "decay", "最低字数", "硬停"],
    risk: "read",
  },
  {
    name: "duration_risk_flag",
    description: "flags 提示动作词或长度风险，实际时长未知。",
    category: "质检",
    keywords: ["时长风险", "duration"],
    risk: "read",
  },
  {
    name: "similarity_heuristic",
    category: "质检",
    keywords: ["相似度", "撞车", "similarity"],
    risk: "read",
  },

  // —— 文件 ——
  {
    name: "fs_ls",
    category: "文件",
    keywords: ["列目录", "ls", "vfs"],
    risk: "read",
  },
  {
    name: "fs_read",
    category: "文件",
    keywords: ["读文件", "fs read"],
    risk: "read",
  },
  {
    name: "fs_write",
    category: "文件",
    keywords: ["写文件", "fs write"],
    risk: "write",
  },
  {
    name: "fs_edit",
    category: "文件",
    keywords: ["改文件", "fs edit"],
    risk: "write",
  },
  {
    name: "fs_grep",
    category: "文件",
    keywords: ["文件搜索", "grep"],
    risk: "read",
  },
  {
    name: "fs_find",
    category: "文件",
    keywords: ["找文件", "find"],
    risk: "read",
  },
  {
    name: "bash",
    category: "文件",
    keywords: ["shell", "bash", "命令"],
    risk: "write",
  },
];

/** Core tier：始终暴露给模型（带完整 schema） */
export const CORE_TOOL_NAMES = TOOL_CATALOG.filter((e) => e.defaultTier === "core").map(
  (e) => e.name,
);

const BY_NAME = new Map(TOOL_CATALOG.map((e) => [e.name, e]));

export function getCatalogEntry(name) {
  const n = String(name || "")
    .trim()
    .replace(/\./g, "_")
    .toLowerCase();
  return BY_NAME.get(n) || null;
}

/**
 * 崩溃边界用：工具调用的副作用类别（与 packages/agent-runtime SideEffectKind 对齐）。
 * read / meta / 未知 → "none"（可安全重试）；写类按名称细分。
 */
export function sideEffectOfTool(name, args) {
  const e = getCatalogEntry(name);
  const operationEffect = toolOperationEffect(e?.name, args);
  if (operationEffect) return operationEffect;
  if (!e || e.risk === "read" || e.risk === "meta") return "none";
  const n = e.name;
  if (n.startsWith("memory_") || n === "lesson_note") return "memory_write";
  if (n.startsWith("job_") || n.startsWith("schedule")) return "job_enqueue";
  if (e.category === "external" || n.startsWith("feishu_")) return "external_api";
  return "artifact_write";
}

export function catalogNames() {
  return TOOL_CATALOG.map((e) => e.name);
}

/**
 * 按 Agent allowlist 计算可搜索 / 可调用集合。
 * - 读类 / meta：默认可搜可调（schema_get/invoke 隐藏）
 * - 写类：必须在 allowlist ∪ core 才可搜可调
 */
export function resolveToolAccess({ allowlist = [], securityMode = "safe" } = {}) {
  const allow = new Set(
    [...allowlist, ...CORE_TOOL_NAMES].map((n) => String(n).replace(/\./g, "_")),
  );

  const searchable = new Set(allow);
  for (const e of TOOL_CATALOG) {
    if (e.name === "tool_schema_get" || e.name === "tool_invoke") continue;
    if (e.risk === "read" || e.risk === "meta") {
      searchable.add(e.name);
    } else if (allow.has(e.name) || e.alwaysAllow) {
      searchable.add(e.name);
    }
  }
  // fs 写 / bash：显式 allow 或 yolo
  if (securityMode === "yolo") {
    searchable.add("fs_write");
    searchable.add("fs_edit");
  }
  if (String(process.env.AGENT_BASH_ENABLED || "").toLowerCase() === "true" && allow.has("bash")) {
    searchable.add("bash");
  } else {
    searchable.delete("bash");
  }

  const callable = new Set(searchable);
  const deferredRead = TOOL_CATALOG.filter(
    (e) => e.risk === "read" && e.defaultTier !== "core" && !allow.has(e.name),
  ).map((e) => e.name);

  return { searchable, callable, allow, deferredRead };
}

/** 系统提示：类别索引短表 */
export function formatCategoryIndexForPrompt() {
  const byCat = new Map();
  for (const e of TOOL_CATALOG) {
    if (e.category === "meta") continue;
    if (!byCat.has(e.category)) byCat.set(e.category, []);
    byCat.get(e.category).push(e.name);
  }
  const order = [
    "选题",
    "人物",
    "结构",
    "分场",
    "台词",
    "提示词",
    "质检",
    "产物",
    "圣经",
    "记忆",
    "知识库",
    "文件",
  ];
  const lines = ["## 可搜索工具类别（用 tool_search 发现后即可直接调用）"];
  for (const cat of order) {
    const names = byCat.get(cat);
    if (!names?.length) continue;
    lines.push(`- ${cat}: ${names.slice(0, 6).join(", ")}${names.length > 6 ? "…" : ""}`);
  }
  return lines.join("\n");
}

/**
 * 关键词搜索目录（可限定 searchable 集合）
 */
export function searchCatalog(query, { limit = 8, searchable = null } = {}) {
  const q = String(query || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const limitN = Math.min(20, Math.max(1, Number(limit) || 8));
  const pool = searchable
    ? TOOL_CATALOG.filter((e) => searchable.has(e.name))
    : TOOL_CATALOG.filter((e) => e.name !== "tool_schema_get" && e.name !== "tool_invoke");

  const scored = pool
    .map((e) => {
      const hay = `${e.name} ${e.category} ${(e.keywords || []).join(" ")}`.toLowerCase();
      let score = q.length ? q.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0) : 1;
      if (q.some(word => normalizeToolName(word) === e.name)) score += 100;
      for (const keyword of e.keywords) {
        if (/[一-龥]/u.test(keyword) && q.some(word => word.includes(keyword.toLowerCase()))) score += keyword.length;
      }
      if (q.length === 1) {
        const word = q[0];
        const name = e.name.toLowerCase();
        if (name.includes(word)) score += 2;
        if (name.startsWith(word)) score += 1;
        if ((e.keywords || []).some((k) => k.toLowerCase().includes(word))) score += 2;
      }
      const entry = { name: e.name, category: e.category, keywords: e.keywords, risk: e.risk, score };
      return e.description ? { ...entry, description: e.description } : entry;
    })
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limitN);

  return scored;
}
