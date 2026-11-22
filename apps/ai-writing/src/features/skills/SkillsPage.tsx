import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  Badge,
  Button,
  HelpCallout,
  HelpIcon,
  HelpTip,
  MarkdownDocument,
  Modal,
  PageHeader,
  Panel,
} from "@xiezuomanju/ui";
import { ChevronDown, FileText, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";

const FOLDER_LABEL: Record<string, string> = {
  _meta: "方法编写规范",
  "ai-collab": "AI 协作 / 四段式",
  analytics: "数据复盘",
  character: "人物深度",
  colleague: "AI 同事",
  deliver: "交付 / 导语",
  duanju: "短剧",
  female_long: "女频中长篇",
  gates: "检查与人工确认",
  harness: "高级工程",
  imitate: "仿写 / 洗稿边界",
  inspiration: "灵感选题",
  ip: "IP 改编",
  kb: "知识库拆书",
  male_long: "男频中长篇",
  manju: "漫剧写作",
  memory: "记忆策展",
  orchestrator: "流程编排",
  product: "产品 / 市场",
  qc: "质检清单",
  quality: "质检 / 去 AI 味",
  short_novel: "短篇",
  structure: "结构 / 爽点模型",
  swap: "换元",
  topic: "选题红黑榜",
};

const SKILL_NAME: Record<string, string> = {
  "skill-authoring-meta": "如何写助手方法",
  "prompt-4part": "提示词四段式",
  "analytics-review": "数据复盘",
  "big5-desire-fear": "大五欲惧秘",
  "soul-check": "灵魂拷问",
  "colleague-proactive": "主动同事",
  logline: "一句话导语",
  "exchange-01": "从0到1交换法",
  "bio-5": "短剧小传五维",
  "empathy-3": "共情三招",
  "gender-path": "男女频路径",
  "redline-duanju": "短剧红线",
  "pitch-pack": "投稿打包",
  "attitude-info-subtext": "台词三层",
  "one-plus-one": "一加一悬念",
  "suspense-4attr": "悬念四属性",
  "comedy-elements": "喜剧元素",
  "unit-sitcom": "单元情景喜剧",
  "product-priority": "解压优先",
  "human-qc-duanju": "短剧人工校稿",
  "revise-20": "修改20法则",
  "location-budget": "场景预算",
  "opening-7": "开场七式",
  "scene-triple": "场三件事",
  "triangle-plot": "三角剧情",
  "beat-20": "二十节拍",
  "midpoint-5types": "中点五型",
  "paywall-10ep": "付费卡点",
  "five-cool-points": "五大爽点",
  "four-shells": "四种故事壳",
  "want-how-via-what": "想看怎么看",
  "eight-tropes": "八大桥段",
  "pace-ratio": "女频节奏配比",
  "risk-list": "雷区清单",
  "tension-pull": "感情拉扯",
  "logic-ack": "人工逻辑确认",
  expand: "灵感升级",
  "emotion-quant": "情绪量化",
  "rebuild-blocks": "压缩重构",
  "select-score": "选书评分",
  "unit-cut": "单元拆解",
  "report-pipeline": "拆书报告流水线",
  "cool-density": "爽点密度",
  "gold-finger-cap": "金手指上限",
  "opening-hook": "开篇钩子",
  "upgrade-loop": "升级循环",
  bio: "人物小传",
  "core-hook": "核心梗",
  "core-hook-critic": "梗评审",
  "dialogue-pressure": "对白压迫感",
  "episode-outline": "前十集大纲",
  "extend-outline": "大纲扩展",
  "qa-correct": "规格校正",
  storyboard: "分镜正文",
  curator: "今日目标",
  batch: "批量督导",
  writing: "写作编排",
  "manju-market-notes": "漫剧市场笔记",
  "ai-self-question": "AI 自问清单",
  "de-ai-v3.8": "去 AI 味 V3.8",
  "immersion-audit": "代入感审计",
  "show-dont-tell": "展示非告知",
  "similarity-boundary": "相似度边界",
  "chapter-outline-cap": "章纲控长",
  "opening-attract": "开篇吸引力",
  "act100-four-acts": "百集四幕",
  "chase-wife-pentalogy": "追妻五部曲",
  "cool-18-models": "十八爽点模型",
  "expect-conflict": "期待与冲突",
  "face-slap-tiers": "打脸三阶",
  "kartian-catalog": "卡提安目录",
  master: "换元规划",
  "genre-redblack": "题材红黑榜",
  "char-seven-step": "人物七步法",
  "proactive-colleague": "主动同事",
  "dialogue-voice": "台词声口",
  "manju-episode-body": "分集正文",
  "manju-length-decay-fix": "字数衰减校正",
  "duanju-ep-outline-cool": "短剧十集大纲",
  "cool-plot-expand": "爽点扩展",
  "cool12-maslow": "马斯洛十二爽点",
  "episode-hook-alts": "集尾钩备选",
  "foreshadow-ledger": "伏笔台账",
  "topic-hotspot": "热点选题",
  "world-setting": "世界观设定",
  "bible-guard": "圣经防线",
  "kb-auto-tag": "自动打标",
  "kb-graph-build": "图谱构建",
  "harness-refine": "轨迹提炼",
  "imitate-wash-boundary": "仿写边界",
  "memory-dreams": "记忆巩固",
  "chapter-summary": "章节摘要",
};

function friendlySkillName(name: string, id: string): string {
  const leaf = id.split("/").pop() || "";
  return SKILL_NAME[name] || SKILL_NAME[leaf] || name || leaf;
}

function normalizeSkillId(value: string): string {
  return String(value || "")
    .replace(/^skills\//, "")
    .replace(/\/SKILL\.md$/, "");
}

function humanize(text: string): string {
  return String(text || "")
    .replace(/\bStage\b/g, "步骤")
    .replace(/\bPrompt\b/g, "写作指令")
    .replace(/\bAgent\b/g, "AI 助手")
    .replace(/\bGate\b/g, "检查")
    .replace(/\bSkill\b/g, "助手方法")
    .replace(/产物/g, "稿件");
}

export function SkillsPage() {
  const search = useSearch({ from: "/skills" }) as { skill?: string };
  const navigate = useNavigate({ from: "/skills" });
  const [folder, setFolder] = useState<string>("all");
  const [activeId, setActiveId] = useState<string | null>(search.skill ?? null);
  const [q, setQ] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);

  const catalogQ = useQuery({
    queryKey: ["agent-catalog"],
    queryFn: () => api.listAgentCatalog(),
  });
  const skillsQ = useQuery({
    queryKey: ["skills"],
    queryFn: () => api.listSkills(),
  });

  const skills = skillsQ.data?.skills ?? [];
  const agents = catalogQ.data?.agents ?? [];

  useEffect(() => {
    if (search.skill) setActiveId(search.skill);
  }, [search.skill]);

  const folders = useMemo(() => {
    const set = new Set(skills.map((s) => s.folder));
    return ["all", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [skills]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return skills.filter((s) => {
      if (folder !== "all" && s.folder !== folder) return false;
      if (!query) return true;
      return `${s.name} ${s.description} ${s.body} ${s.id}`.toLowerCase().includes(query);
    });
  }, [skills, folder, q]);

  const active = skills.find((s) => s.id === activeId) ?? null;
  const currentFolderLabel = folder === "all" ? "全部分类" : FOLDER_LABEL[folder] ?? folder;

  const openSkill = (id: string) => {
    setActiveId(id);
    void navigate({ search: { skill: id } });
  };

  const closeSkill = () => {
    setActiveId(null);
    void navigate({ search: {} });
  };

  return (
    <div className="page page--wide skills-page">
      <PageHeader
        title="助手方法库"
        description={`共 ${skills.length || "…"} 个方法。看看每位写作助手会做什么、不会做什么。`}
        actions={
          <span className="badge">
            <FileText size={12} />
            {filtered.length} / {skills.length} 个方法
          </span>
        }
      />

      <HelpCallout
        title="你需要改这里吗？"
        tone="tip"
        collapsible
        defaultOpen={false}
      >
        一般不需要。这里像每位 AI 助手的工作说明，系统会在需要时自动使用。你如果好奇「为什么 AI
        不一次写完整本书」，打开对应方法就能看到原因。
        <HelpIcon text="固定规则关系到检查能否通过。要调整写作风格，请去「写作指令」页修改可调整的部分。" />
      </HelpCallout>

      <div className="skills-toolbar">
        <label className="row" style={{ gap: 7, flex: 1, minWidth: 0 }}>
          <Search size={15} style={{ color: "var(--faint)", flex: "none" }} />
          <input
            className="input"
            style={{ width: "min(380px, 44vw)" }}
            placeholder="搜索方法名称或内容…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <span className="skills-toolbar__count">
          {currentFolderLabel} · {filtered.length} 个
        </span>
      </div>

      <div className="skills-filter" data-open={filterOpen ? "true" : "false"}>
        <button
          type="button"
          className="skills-filter__toggle"
          aria-expanded={filterOpen}
          onClick={() => setFilterOpen((v) => !v)}
        >
          <SlidersHorizontal size={13} />
          分类筛选
          <span className="skills-filter__current">{currentFolderLabel}</span>
          <ChevronDown size={13} />
        </button>
        <div className="skills-filter__chips">
          <div className="skills-filter__chips-inner">
            <div className="skills-filter__chips-row">
              {folders.map((f) => (
                <button
                  key={f}
                  type="button"
                  className="skills-filter__chip"
                  data-active={folder === f}
                  onClick={() => setFolder(f)}
                >
                  {f === "all" ? "全部" : FOLDER_LABEL[f] ?? f}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="skills-layout">
        <aside className="skills-side">
          <Panel
            title={
              <span>
                写作助手
                <HelpIcon text="写作时，系统会把任务交给这些助手。点一下可以看它负责什么。" />
              </span>
            }
            actions={<Badge>{agents.length}</Badge>}
            className="panel--fill"
          >
            <div className="stack" style={{ gap: 2 }}>
              {agents.map((a) => (
                <HelpTip key={a.id} label={a.summary} side="right">
                  <button
                    type="button"
                    className="binder-item"
                    data-active={
                      normalizeSkillId(active?.id ?? "") === normalizeSkillId(a.skillPath)
                    }
                    onClick={() => {
                      setFolder("all");
                      setQ("");
                      const agentSkillId = normalizeSkillId(a.skillPath);
                      const target = skills.find(
                        (s) =>
                          normalizeSkillId(s.id) === agentSkillId ||
                          normalizeSkillId(s.path ?? "") === agentSkillId,
                      );
                      openSkill(target?.id ?? a.skillPath);
                    }}
                  >
                    <span style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
                      <div className="binder-item__label">{a.name}</div>
                      <div className="binder-item__hint">适合：{a.when}</div>
                    </span>
                  </button>
                </HelpTip>
              ))}
              {!agents.length && !catalogQ.isLoading && (
                <div className="empty">暂无目录。请确认后端已启动，或切到 http 模式。</div>
              )}
            </div>
          </Panel>
        </aside>

        <section className="skills-main">
          <Panel
            title="方法列表"
            actions={<span className="faint" style={{ fontSize: 11 }}>点击打开全文</span>}
            className="panel--fill"
          >
            <div className="skills-grid">
              {filtered.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="skill-card"
                  data-active={activeId === s.id}
                  onClick={() => openSkill(s.id)}
                >
                  <div className="skill-card__head">
                    <div className="skill-card__name">{friendlySkillName(s.name, s.id)}</div>
                    <Badge>{FOLDER_LABEL[s.folder] ?? s.folder}</Badge>
                  </div>
                  <div className="skill-card__desc">
                    {s.description ? humanize(s.description) : "（无简介，点开阅读正文）"}
                  </div>
                  <div className="skill-card__meta">
                    {(s.gates || []).slice(0, 1).map((g) => (
                      <Badge key={g} tone="warn">
                        检查 {g}
                      </Badge>
                    ))}
                    {(s.locks || []).slice(0, 1).map((l) => (
                      <Badge key={l}>
                        固定 {l}
                      </Badge>
                    ))}
                  </div>
                </button>
              ))}
            </div>
            {!filtered.length && (
              <div className="empty">
                <FileText size={18} />
                没有找到对应的方法。试试清空搜索或换一个分类。
              </div>
            )}
          </Panel>
        </section>
      </div>

      <Modal
        open={!!active}
        onOpenChange={(open) => {
          if (!open) closeSkill();
        }}
        className="skill-modal"
        bodyClassName="skill-modal__body"
        title={active ? friendlySkillName(active.name, active.id) : "写作助手说明书"}
        description={active ? humanize(active.description || "工作说明") : undefined}
        footer={
          <>
            <span className="faint" style={{ marginRight: "auto", fontSize: 11 }}>
              方法位置：{active?.path}
            </span>
            <Button onClick={closeSkill}>关闭</Button>
          </>
        }
      >
        {active ? (
          <div className="skill-modal__scroll">
            <div className="skill-modal__meta">
              <Badge>{FOLDER_LABEL[active.folder] ?? active.folder}</Badge>
              {(active.locks || []).map((l) => (
                <HelpTip key={l} label="固定规则：系统会强制执行，不能随意改动。">
                  <Badge>固定 {l}</Badge>
                </HelpTip>
              ))}
              {(active.gates || []).map((g) => (
                <HelpTip key={g} label="检查项：生成结束后会自动检查，不通过就不算完成。">
                  <Badge tone="warn">检查 {g}</Badge>
                </HelpTip>
              ))}
            </div>
            <div className="skill-modal__path">id：{active.id}</div>
            <MarkdownDocument source={active.body} />
          </div>
        ) : null}
      </Modal>

      <p className="faint" style={{ margin: 0, fontSize: 10.5 }}>
        这些说明由系统自动使用，你不需要手动设置。
        {typeof skillsQ.data?.count === "number" ? ` · 共 ${skillsQ.data.count} 个方法` : ""}
      </p>
    </div>
  );
}
