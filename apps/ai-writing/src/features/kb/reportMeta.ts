/** 拆书报告：给作家看的名称与说明（非技术字段名） */

export type ReportMeta = {
  /** 侧栏短名 */
  label: string;
  /** 一句话：这份报告能帮你什么 */
  purpose: string;
  /** 怎么用 */
  howTo: string;
};

const META: Record<string, ReportMeta> = {
  dissect_params: {
    label: "拆书参数",
    purpose:
      "按九格 11 项模板拆对标：基本信息、期待感、设定、脉络、冲突、情绪曲线、人物关系、反转、起承转合、七步法、节奏风格。",
    howTo:
      "先明确拆书目的（故事线/细纲/人物/核心梗）；按单元故事拆，只深拆写得好的部分；与原文校对多轮后再应用到写作台。",
  },
  unit_story: {
    label: "单元故事",
    purpose:
      "大=全篇、中=一卷、小=单元（约 1 万字/1～5 章）。长篇=N 个单元；剧本≈5～8 个单元。",
    howTo:
      "先拆章纲看故事线，再标记「值得深拆」的单元（如大奉碎银案）；禁止无目的拆全书 100 万字。",
  },
  seven_steps: {
    label: "七步法",
    purpose:
      "目标→阻碍→行动→结果（通常失败）→意外→转折→结局；可嵌套；与人设七步不同。",
    howTo:
      "拆书时反向提问验证 AI；若「没意外也没转折」或结果过早成功，优先补这两步再写正文。",
  },
  core_hook_extract: {
    label: "核心梗提取",
    purpose:
      "核心梗=情绪链条、可跨题材；情节卡=固定步骤菜谱。分爽点/情感/转折型，及一级/二级/单元层级。",
    howTo:
      "抽象化具体场景（客栈→公共空间），提取情绪拉扯；只采纳带动机与开篇结构的条目进入总纲。",
  },
  core_hook: {
    label: "核心梗提取",
    purpose: "抽出真正可卖的「梗」，和只是情节卡的部分分开。",
    howTo: "选梗时只采纳带动机和开篇结构的条目，再进大纲。",
  },
  emotion_curve: {
    label: "情绪曲线",
    purpose: "量化情绪起伏，对照九格「先抑后扬 / 爽虐节奏」。",
    howTo: "若曲线太平，说明缺中爽/大爽卡点，先改大纲再改字。",
  },
  cool_pain_map: {
    label: "爽点 / 虐点",
    purpose: "标出打脸、反杀、收获等爽点，以及铺垫用的虐点分布。",
    howTo: "仿写时对齐「爽点密度」，不要只抄人设。",
  },
  cool_point_map: {
    label: "爽点 / 虐点",
    purpose: "标出打脸、反杀、收获等爽点，以及铺垫用的虐点分布。",
    howTo: "仿写时对齐「爽点密度」，不要只抄人设。",
  },
  hook_map: {
    label: "期待感 / 钩子",
    purpose: "集尾悬念、未解之谜、惊人宣言——读者追更靠这些。",
    howTo: "每集结尾对照：有没有钩子？没有就补一刀再交稿。",
  },
  style_extract: {
    label: "文风要素",
    purpose: "抽句式、节奏、信息差等「写法」，方便学风格而不抄内容。",
    howTo: "去 AI 味改稿时，对照短句/快节奏是否还在。",
  },
  style_profile: {
    label: "文风要素",
    purpose: "抽句式、节奏、信息差等「写法」，方便学风格而不抄内容。",
    howTo: "去 AI 味改稿时，对照短句/快节奏是否还在。",
  },
  gap_report: {
    label: "对标差距",
    purpose: "你现在的稿 vs 爆款结构：已达标 / 还缺什么。",
    howTo: "优先补「需补强」条目，再批量写正文。",
  },
  redline_report: {
    label: "风险红线",
    purpose: "标出题材/擦边/价值观/审核敏感点，避免投出去才翻车。",
    howTo: "高风险必须改设定或删场面；不要用「注意合规」空话糊弄。",
  },
  redline: {
    label: "风险红线",
    purpose: "标出题材/擦边/价值观/审核敏感点，避免投出去才翻车。",
    howTo: "高风险必须改设定或删场面；不要用「注意合规」空话糊弄。",
  },
};

export function getReportMeta(reportType: string, title?: string): ReportMeta {
  return (
    META[reportType] ?? {
      label: title || reportType,
      purpose: "这份报告帮你从对标作品里提炼可写作的洞察。",
      howTo: "读完要点后，用下方「应用到写作台」接到你的项目。",
    }
  );
}

/** JSON 字段 → 中文标签 */
export const FIELD_LABELS: Record<string, string> = {
  worldSetting: "世界观设定",
  emotionCurve: "情绪曲线",
  sevenSteps: "七步法",
  coreHookExtract: "核心梗提取",
  unitStory: "单元故事",
  coolPainMap: "爽点 / 虐点",
  hookMap: "期待感 / 钩子",
  styleExtract: "文风要素",
  gapReport: "对标差距",
  redlineReport: "风险红线",
  docType: "文档类型",
  wordCount: "字数",
  createdAt: "创建时间",
  updatedAt: "更新时间",
  summary: "一句话总结",
  findings: "关键发现",
  quotes: "原文摘录",
  markdown: "详细说明",
  units: "故事单元",
  steps: "七步法步骤",
  cool: "爽点",
  abuse: "虐点",
  hooks: "钩子列表",
  sentence: "句式",
  pacing: "节奏",
  voice: "声口 / 信息差",
  good: "已达标",
  gaps: "需补强",
  values: "情绪分值（约 -10 ~ +10）",
  coreHook: "核心梗",
  titleHook: "标题钩",
  motivation: "动机",
  crisis: "危机",
  openingStructure: "开篇结构",
  riskFlags: "风险提示",
  nodes: "人物节点",
  edges: "关系边",
  tropes: "桥段",
  error: "分析说明",
  pending: "是否生成中",
  jobId: "任务编号",
  docTitle: "文档标题",
  risks: "风险点",
  severity: "严重度",
  rewrite: "改写建议",
  redFlags: "红旗项",
  platforms: "平台口径",
  platform: "平台",
  genre: "题材",
  tags: "标签",
  targetReaders: "目标读者",
  mainStory: "主线故事",
  coreConflict: "核心冲突",
  freshness: "新鲜度",
  pros: "优点",
  cons: "风险 / 缺点",
  advice: "行动建议",
  nextAction: "下一步",
  basic: "基本信息/选题",
  expectations: "期待感",
  setting: "故事设定",
  storyline: "故事脉络/核心内容",
  conflicts: "核心冲突",
  relationships: "人物关系",
  twists: "故事反转",
  qiChengZhuanHe: "起承转合",
  rhythmStyle: "整体节奏/风格",
  unitStories: "单元故事列表",
  extractedHooks: "提取的核心梗",
  proofread: "人工校对",
  favoriteWorthDeep: "值得深拆的单元",
  purpose: "拆书目的",
  textCheck: "文本编码检查",
  emotionChain: "情绪链条",
  abstractions: "抽象化映射",
  kind: "核心梗/情节卡",
  category: "梗类型",
  size: "梗层级",
  plotCardSteps: "情节卡固定步骤",
  plotPointCount: "情节点个数",
  goal: "目标",
  obstacle: "阻碍",
  action: "行动",
  result: "结果",
  accident: "意外",
  twist: "转折",
  ending: "结局",
  reverseValidate: "反向拆书验证",
};

export function fieldLabel(key: string): string {
  return (
    FIELD_LABELS[key] ??
    key.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2")
  );
}
