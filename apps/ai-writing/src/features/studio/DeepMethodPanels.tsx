/**
 * 九格方法论深度工作台：设定 / 七步人设 / 爽点 / 台词三层 / Beat20 / 投稿信息表。
 * 供 deliverables、FormatWorkspaces、ManjuPanels 复用，避免各处再写半截 stub。
 */
import type { Artifact, ProjectFormat } from "@xiezuomanju/domain";
import {
  CHARLIE_BEAT20,
  defaultCharlieBeatRows,
  MANJU_COOL18_MODELS,
  MANJU_KARTIAN_TYPES,
  ManjuPipelineWorkflowSchema,
  type CharlieBeatRow,
} from "@xiezuomanju/domain";
import {
  Badge,
  Button,
  CollapsibleSection,
  MarkdownDocument,
  Panel,
  Tabs,
  toast,
} from "@xiezuomanju/ui";
import { Select } from "@xiezuomanju/ui";
import { useEffect, useMemo, useState } from "react";
import {
  characterBodyOf,
  downloadExport,
  episodeNoOf,
  hookBodyOf,
  manuscriptExportSections,
  outlineBodyOf,
  type ExportFormat,
  type ExportSection,
} from "./exportUtils";
import { CHART_COLORS, EmotionCurve, type EmotionPoint } from "../../components/charts";
import { runAgentFeedback } from "./runAgentFeedback";
import { usePersistedState } from "./usePersistedState";

const GF_TYPES = [
  { id: "system", label: "系统", tip: "主流；须有任务/代价/上限" },
  { id: "prophet", label: "先知", tip: "预知/穿书；信息差驱动行动" },
  { id: "talent", label: "天赋", tip: "职业/血脉天赋；与世界规则咬合" },
  { id: "本体", label: "本体", tip: "自身即金手指；禁无脑无敌" },
] as const;

const GF_REQS = [
  { id: "mechanism", label: "机制清楚", hint: "能说清怎么用、触发条件、产出" },
  { id: "cap", label: "上限与规则", hint: "同级无敌、跨阶困难；有代价" },
  { id: "fit", label: "匹配世界观", hint: "能力不跳出世界运行规则" },
] as const;

type FiveElements = {
  who: string;
  world: string;
  power: string;
  conflict: string;
  reward: string;
};

type GoldFinger = {
  type: string;
  mechanism: string;
  cap: string;
  cost: string;
  reqs: Record<string, boolean>;
};

type WorldBible = {
  rules: string;
  dilemmaLow: string;
  dilemmaHigh: string;
  omitNotes: string;
};

type OpeningCast = {
  debuffStack: string;
  firstScenePlan: string;
  humanityLine: string;
};

/** 设定包：五要素 + 金手指三要求四类型 + 世界观 + 开头情绪 */
export function SettingWorkbench({ projectId }: { projectId?: string }) {
  const [five, setFive] = usePersistedState<FiveElements>(projectId, "setting-five", {
    who: "",
    world: "",
    power: "",
    conflict: "",
    reward: "",
  });
  const [gf, setGf] = usePersistedState<GoldFinger>(projectId, "setting-gf", {
    type: "system",
    mechanism: "",
    cap: "",
    cost: "",
    reqs: { mechanism: false, cap: false, fit: false },
  });
  const [world, setWorld] = usePersistedState<WorldBible>(projectId, "setting-world", {
    rules: "",
    dilemmaLow: "",
    dilemmaHigh: "",
    omitNotes: "",
  });
  const [opening, setOpening] = usePersistedState<OpeningCast>(projectId, "setting-opening", {
    debuffStack: "",
    firstScenePlan: "",
    humanityLine: "可冷酷，禁无情/反人类/圣母崩塌",
  });
  const [tab, setTab] = useState("five");
  const [busy, setBusy] = useState(false);

  const fiveOk = Object.values(five).every((v) => v.trim());
  const gfOk = GF_REQS.every((r) => gf.reqs[r.id]) && gf.mechanism.trim() && gf.cap.trim();
  const worldOk = world.rules.trim().length >= 12;
  const openingOk = opening.debuffStack.trim() && opening.firstScenePlan.trim();

  const runSetting = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      await runAgentFeedback(projectId, "topic.world_setting", { label: "topic.world_setting", inputJson: { five, goldFinger: gf, world, opening },
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <CollapsibleSection
        title="设定包（12 课）"
        storageKey={projectId ? `deep-${projectId}-setting` : undefined}
        actions={
          <div className="row" style={{ gap: 6 }}>
            <Badge tone={fiveOk && gfOk && worldOk ? "ok" : "warn"}>
              {fiveOk && gfOk && worldOk ? "可写入 bible" : "未齐"}
            </Badge>
            <Button variant="primary" disabled={!projectId || busy} onClick={() => void runSetting()}>
              生成/加固设定包
            </Button>
          </div>
        }
      >
        <p className="muted" style={{ marginTop: 0 }}>
          故事梗五要素决定评分上限；金手指是最重要的单一写作点；世界观写规则不是写类型标签。
          三大题材分步（升级/反套路/后悔）与收藏&gt;5万闸见「漫剧题材轨（12.md）」工作台。
        </p>
        <Tabs
          tabs={[
            { id: "five", label: "五要素" },
            { id: "gf", label: "金手指" },
            { id: "world", label: "世界观" },
            { id: "opening", label: "开头情绪" },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === "five" && (
          <div className="field-grid" style={{ marginTop: 10 }}>
            {(
              [
                ["who", "什么人", "初始身份 + buff/debuff"],
                ["world", "什么世界", "独特运行规则一句话"],
                ["power", "什么能力", "金手指名称"],
                ["conflict", "解决什么冲突", "近冲突必须具现"],
                ["reward", "得到什么收获", "故事梗收口"],
              ] as const
            ).map(([k, label, ph]) => (
              <label key={k} className="field" style={{ gridColumn: k === "reward" ? "1 / -1" : undefined }}>
                <span>{label}</span>
                <input
                  className="input"
                  placeholder={ph}
                  value={five[k]}
                  onChange={(e) => setFive((s) => ({ ...s, [k]: e.target.value }))}
                />
              </label>
            ))}
            <Badge tone={fiveOk ? "ok" : "fail"}>{fiveOk ? "五要素齐全" : "五要素缺项"}</Badge>
          </div>
        )}
        {tab === "gf" && (
          <div className="stack" style={{ marginTop: 10, gap: 10 }}>
            <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
              {GF_TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="badge"
                  style={gf.type === t.id ? { borderColor: "var(--accent)" } : undefined}
                  title={t.tip}
                  onClick={() => setGf((s) => ({ ...s, type: t.id }))}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <label className="field">
              <span>机制（怎么用）</span>
              <textarea
                className="textarea"
                rows={2}
                value={gf.mechanism}
                onChange={(e) => setGf((s) => ({ ...s, mechanism: e.target.value }))}
                placeholder="触发条件、产出、频率…"
              />
            </label>
            <div className="field-grid">
              <label className="field">
                <span>上限 / 规则</span>
                <input
                  className="input"
                  value={gf.cap}
                  onChange={(e) => setGf((s) => ({ ...s, cap: e.target.value }))}
                  placeholder="同级无敌、跨阶困难…"
                />
              </label>
              <label className="field">
                <span>代价</span>
                <input
                  className="input"
                  value={gf.cost}
                  onChange={(e) => setGf((s) => ({ ...s, cost: e.target.value }))}
                  placeholder="失忆/寿命/暴露风险…"
                />
              </label>
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <strong style={{ fontSize: 13 }}>三大要求（须人工勾选）</strong>
              {GF_REQS.map((r) => (
                <label key={r.id} className="row" style={{ gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={!!gf.reqs[r.id]}
                    onChange={(e) =>
                      setGf((s) => ({ ...s, reqs: { ...s.reqs, [r.id]: e.target.checked } }))
                    }
                  />
                  <span>
                    {r.label}
                    <span className="muted"> · {r.hint}</span>
                  </span>
                </label>
              ))}
              <Badge tone={gfOk ? "ok" : "fail"}>{gfOk ? "金手指可过闸" : "三大要求未齐"}</Badge>
            </div>
            {projectId && (
              <Button
                size="sm"
                onClick={() => void runAgentFeedback(projectId, "male.gold_finger", { label: "male.gold_finger", inputJson: gf })}
              >
                金手指上限体检（male.gold_finger）
              </Button>
            )}
          </div>
        )}
        {tab === "world" && (
          <div className="stack" style={{ marginTop: 10, gap: 8 }}>
            <label className="field">
              <span>独特运行规则（非「末日」「修仙」两字）</span>
              <textarea
                className="textarea"
                rows={3}
                value={world.rules}
                onChange={(e) => setWorld((s) => ({ ...s, rules: e.target.value }))}
              />
            </label>
            <div className="field-grid">
              <label className="field">
                <span>困境下限</span>
                <input
                  className="input"
                  value={world.dilemmaLow}
                  onChange={(e) => setWorld((s) => ({ ...s, dilemmaLow: e.target.value }))}
                />
              </label>
              <label className="field">
                <span>困境上限 / 对手性质</span>
                <input
                  className="input"
                  value={world.dilemmaHigh}
                  onChange={(e) => setWorld((s) => ({ ...s, dilemmaHigh: e.target.value }))}
                />
              </label>
            </div>
            <label className="field">
              <span>可省 / 不可省备注（后悔流历史付出不可省）</span>
              <textarea
                className="textarea"
                rows={2}
                value={world.omitNotes}
                onChange={(e) => setWorld((s) => ({ ...s, omitNotes: e.target.value }))}
              />
            </label>
            <Badge tone={worldOk ? "ok" : "warn"}>{worldOk ? "规则够具体" : "规则过短"}</Badge>
          </div>
        )}
        {tab === "opening" && (
          <div className="stack" style={{ marginTop: 10, gap: 8 }}>
            <label className="field">
              <span>Debuff 叠满清单（递进）</span>
              <textarea
                className="textarea"
                rows={3}
                value={opening.debuffStack}
                onChange={(e) => setOpening((s) => ({ ...s, debuffStack: e.target.value }))}
                placeholder="普通被甩 → 三年奉献被甩 → 绝症+当面目睹…"
              />
            </label>
            <label className="field">
              <span>第一集第一节（约 500–800 字）情绪计划</span>
              <textarea
                className="textarea"
                rows={3}
                value={opening.firstScenePlan}
                onChange={(e) => setOpening((s) => ({ ...s, firstScenePlan: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>人味底线</span>
              <input
                className="input"
                value={opening.humanityLine}
                onChange={(e) => setOpening((s) => ({ ...s, humanityLine: e.target.value }))}
              />
            </label>
            <Badge tone={openingOk ? "ok" : "warn"}>{openingOk ? "开头情绪已设计" : "待补叠 buff"}</Badge>
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
}

const SEVEN_STEPS = [
  { id: "motive", label: "动机" },
  { id: "goal", label: "目标" },
  { id: "wish", label: "愿望" },
  { id: "obstacle", label: "阻碍" },
  { id: "method", label: "解决办法" },
  { id: "result", label: "结果" },
  { id: "bonus", label: "意外收获" },
] as const;

type SevenForm = Record<(typeof SEVEN_STEPS)[number]["id"], string> & {
  name: string;
  role: string;
  desire: string;
  fear: string;
  secret: string;
};

/** 人设七步法完整表单 */
export function SevenStepCharWorkbench({
  projectId,
  artifacts,
}: {
  projectId?: string;
  artifacts?: Artifact[];
}) {
  const [form, setForm] = usePersistedState<SevenForm>(projectId, "char-seven", {
    name: "",
    role: "主角",
    motive: "",
    goal: "",
    wish: "",
    obstacle: "",
    method: "",
    result: "",
    bonus: "",
    desire: "",
    fear: "",
    secret: "",
  });
  const legacyBiography = (form as SevenForm & { arc?: unknown }).arc;
  const filled = SEVEN_STEPS.filter((s) => form[s.id].trim()).length;
  const ok = filled === 7 && form.name.trim();

  return (
    <div className="stack">
      {typeof legacyBiography === "string" && legacyBiography.trim() && (
        <CollapsibleSection title="已恢复的旧版人物小传">
          <p className="muted">旧版资料已保留，可参照补充下方七步表单。</p>
          <p style={{ whiteSpace: "pre-wrap" }}>{legacyBiography}</p>
        </CollapsibleSection>
      )}
      <CollapsibleSection
        title="人物设计七步法（8 课）"
        storageKey={projectId ? `deep-${projectId}-char7` : undefined}
        actions={
          <div className="row" style={{ gap: 6 }}>
            <Badge tone={ok ? "ok" : "warn"}>
              {filled}/7 步{form.name ? "" : " · 缺姓名"}
            </Badge>
            <Button
              disabled={!projectId}
              onClick={() =>
                projectId &&
                void runAgentFeedback(projectId, "char.bible_big5", { label: "char.bible_big5", inputJson: form })
              }
            >
              打开10课人设深度台 / Big5
            </Button>
            <Button
              variant="primary"
              disabled={!projectId || !ok}
              onClick={() =>
                projectId &&
                void runAgentFeedback(projectId, "char.seven_step", { label: "char.seven_step", inputJson: form })
              }
            >
              生成七步人设卡
            </Button>
          </div>
        }
      >
        <p className="muted" style={{ marginTop: 0 }}>
          动机 → 目标 → 愿望 → 阻碍 → 解决办法 → 结果 → 意外收获。人设先定，事件必须与人设强关联，否则
          OOC。
        </p>
        <div className="field-grid">
          <label className="field">
            <span>姓名</span>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>功能位</span>
            <Select
              className="select"
              value={form.role}
              onChange={(e) => setForm((s) => ({ ...s, role: e.target.value }))}
            >
              {["主角", "反派", "助攻", "爱情线", "竞争对手"].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </Select>
          </label>
          {SEVEN_STEPS.map((s) => (
            <label key={s.id} className="field" style={{ gridColumn: "1 / -1" }}>
              <span>
                {s.label}
                {!form[s.id].trim() && <Badge tone="fail">缺</Badge>}
              </span>
              <textarea
                className="textarea"
                rows={2}
                value={form[s.id]}
                onChange={(e) => setForm((prev) => ({ ...prev, [s.id]: e.target.value }))}
              />
            </label>
          ))}
          <label className="field">
            <span>欲望</span>
            <input
              className="input"
              value={form.desire}
              onChange={(e) => setForm((s) => ({ ...s, desire: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>恐惧</span>
            <input
              className="input"
              value={form.fear}
              onChange={(e) => setForm((s) => ({ ...s, fear: e.target.value }))}
            />
          </label>
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span>终极秘密</span>
            <input
              className="input"
              value={form.secret}
              onChange={(e) => setForm((s) => ({ ...s, secret: e.target.value }))}
            />
          </label>
        </div>
      </CollapsibleSection>
      {artifacts && artifacts.some((a) => a.type === "character") && (
        <Panel title="已有人设产物">
          {artifacts
            .filter((a) => a.type === "character")
            .map((a) => (
              <details key={a.id} style={{ marginBottom: 8 }}>
                <summary>{a.title}</summary>
                <MarkdownDocument source={a.bodyMarkdown ?? ""} />
              </details>
            ))}
        </Panel>
      )}
    </div>
  );
}

const COOL12 = [
  "生存困难",
  "死里逃生",
  "美女如云",
  "男配爱女主",
  "碾压反派",
  "扮猪吃虎",
  "法宝神技",
  "报仇雪恨",
  "挑战权威",
  "推倒冰山",
  "好为人师",
  "推翻大boss",
];

const NEED5 = [
  { id: "physio", label: "生理", tropes: [0] },
  { id: "safe", label: "安全", tropes: [1] },
  { id: "belong", label: "归属", tropes: [2, 3] },
  { id: "respect", label: "尊重", tropes: [4, 5, 6, 7] },
  { id: "self", label: "自我实现", tropes: [8, 9, 10, 11] },
];

const COOL5_DUANJU = ["身份打脸", "实力碾压", "智斗反转", "情感兑现", "财富/地位跃迁"];

/** 爽点：十二套路 + 五类型 + 十八模型 + 情绪曲线（十八模型来自手册常量，≠ L6 cool12） */
export function CoolPointWorkbench({
  projectId,
  emotionValues,
  artifacts,
}: {
  projectId?: string;
  emotionValues?: number[];
  artifacts?: Artifact[];
}) {
  const [need, setNeed] = useState("respect");
  const [picked12, setPicked12] = usePersistedState<number[]>(projectId, "cool12", [5, 4]);
  const [picked18, setPicked18] = usePersistedState<number[]>(projectId, "cool18", [1, 2]);
  const [tab, setTab] = useState("12");
  const values = emotionValues?.length
    ? emotionValues
    : [-8, -6, -2, 3, -1, 5, 2, 7, -3, 8];

  // 情绪曲线叠加付费点/卡点/情绪峰标记（来自分集大纲）。
  const curvePoints: EmotionPoint[] = useMemo(() => {
    const outlines = (artifacts ?? [])
      .filter((a) => a.type === "episode_outline")
      .sort(
        (a, b) =>
          Number((a.bodyJson as { episodeNo?: number } | null)?.episodeNo ?? 0) -
          Number((b.bodyJson as { episodeNo?: number } | null)?.episodeNo ?? 0),
      );
    const markAt = (i: number): EmotionPoint["mark"] => {
      const o = outlines[i]?.bodyJson as
        | {
            paywallPoint?: string;
            paywallHint?: string;
            cliffType?: string;
            cliffText?: string;
            emotionPeak?: number;
          }
        | undefined;
      if (!o) return undefined;
      if (o.paywallPoint || o.paywallHint) return "paywall";
      if (o.cliffType || o.cliffText) return "card";
      if (typeof o.emotionPeak === "number" && o.emotionPeak >= 6) return "peak";
      return undefined;
    };
    return values.map((v, i) => ({ x: `EP${i + 1}`, value: v, mark: markAt(i) }));
  }, [values, artifacts]);

  const toggle = (list: number[], i: number, set: (v: number[]) => void) => {
    set(list.includes(i) ? list.filter((x) => x !== i) : [...list, i]);
  };

  const writeCool18ToHandbookDraft = () => {
    if (!projectId) return;
    const names = picked18.map((i) => MANJU_COOL18_MODELS[i]?.id).filter(Boolean) as string[];
    try {
      const key = `deep:${projectId}:manju-pipeline-wf`;
      const raw = localStorage.getItem(key);
      const base = raw
        ? ManjuPipelineWorkflowSchema.parse(JSON.parse(raw))
        : ManjuPipelineWorkflowSchema.parse({});
      const next = {
        ...base,
        handbookOps: {
          ...base.handbookOps,
          pickedCool18Draft: names,
        },
      };
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="stack">
      <CollapsibleSection
        title="爽点引擎"
        storageKey={projectId ? `deep-${projectId}-cool` : undefined}
      >
        <Tabs
          tabs={[
            { id: "12", label: "十二套路" },
            { id: "5", label: "短剧五爽点" },
            { id: "18", label: "漫剧十八模型" },
            { id: "curve", label: "情绪曲线" },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === "12" && (
          <div className="stack" style={{ marginTop: 10, gap: 10 }}>
            <p className="muted" style={{ margin: 0 }}>
              先定马斯洛需求层次，再选套路；须多梗叠加。扮猪吃虎必须先写够「废」。
              完备中间态（四前提/信息差/三阶/代入感）见 NinesLesson6Panels「爽点打脸」十步台；本台为选型+Agent 薄入口。
            </p>
            <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
              {NEED5.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className="badge"
                  style={need === n.id ? { borderColor: "var(--accent)" } : undefined}
                  onClick={() => setNeed(n.id)}
                >
                  {n.label}
                </button>
              ))}
            </div>
            <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
              {COOL12.map((name, i) => {
                const inNeed = NEED5.find((n) => n.id === need)?.tropes.includes(i);
                const on = picked12.includes(i);
                return (
                  <button
                    key={name}
                    type="button"
                    className="badge"
                    style={{
                      opacity: inNeed ? 1 : 0.55,
                      borderColor: on ? "var(--accent)" : undefined,
                    }}
                    onClick={() => toggle(picked12, i, setPicked12)}
                  >
                    {i + 1}. {name}
                  </button>
                );
              })}
            </div>
            <Badge tone={picked12.length >= 2 ? "ok" : "warn"}>
              已选 {picked12.length} 套路（建议 ≥2 叠加）
            </Badge>
            <Button
              variant="primary"
              disabled={!projectId}
              onClick={() =>
                projectId &&
                void runAgentFeedback(projectId, "struct.cool12", { label: "struct.cool12", inputJson: {
                    primary_need: need,
                    tropes: picked12.map((i) => ({ id: i + 1, name: COOL12[i] })),
                  },
                })
              }
            >
              生成十二套路分集映射
            </Button>
          </div>
        )}
        {tab === "5" && (
          <div className="stack" style={{ marginTop: 10, gap: 8 }}>
            <p className="muted" style={{ margin: 0 }}>
              查理短剧投放侧压缩版：身份 / 实力 / 智斗 / 情感 / 跃迁。
            </p>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {COOL5_DUANJU.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <Button
              variant="primary"
              disabled={!projectId}
              onClick={() => projectId && void runAgentFeedback(projectId, "topic.cool_point_5", { label: "topic.cool_point_5" })}
            >
              生成五爽点选题卡
            </Button>
          </div>
        )}
        {tab === "18" && (
          <div className="stack" style={{ marginTop: 10, gap: 8 }}>
            <p className="muted" style={{ margin: 0, fontSize: 11 }}>
              手册十八模型（五维）；≠ L6 Maslow+cool12。悬念勾子/爆点/情感钩见卡点三类。
            </p>
            {(["力量与征服", "成长与逆袭", "智慧与谋略", "情感与关系", "机遇与命运"] as const).map(
              (dim) => (
                <div key={dim} className="stack" style={{ gap: 4 }}>
                  <strong style={{ fontSize: 12 }}>{dim}</strong>
                  <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                    {MANJU_COOL18_MODELS.map((m, i) =>
                      m.dim === dim ? (
                        <button
                          key={m.id}
                          type="button"
                          className="badge"
                          title={m.tip}
                          style={
                            picked18.includes(i) ? { borderColor: "var(--accent)" } : undefined
                          }
                          onClick={() => toggle(picked18, i, setPicked18)}
                        >
                          {m.id}
                        </button>
                      ) : null,
                    )}
                  </div>
                </div>
              ),
            )}
            <div className="stack" style={{ gap: 4 }}>
              <strong style={{ fontSize: 12 }}>卡点三类（只读参考）</strong>
              {MANJU_KARTIAN_TYPES.map((c) => (
                <p key={c.category} className="muted" style={{ margin: 0, fontSize: 11 }}>
                  {c.category}（{c.goal}）：{c.types.join(" / ")}
                </p>
              ))}
            </div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <Button
                variant="primary"
                disabled={!projectId}
                onClick={() =>
                  projectId &&
                  void runAgentFeedback(projectId, "struct.cool18", {
                    label: "struct.cool18",
                    inputJson: {
                      models: picked18.map((i) => MANJU_COOL18_MODELS[i]?.id).filter(Boolean),
                    },
                  })
                }
              >
                批量爽虐点（cool18）
              </Button>
              <Button
                disabled={!projectId}
                onClick={() =>
                  projectId &&
                  void runAgentFeedback(projectId, "struct.kartian", {
                    label: "struct.kartian",
                  })
                }
              >
                卡点类型库
              </Button>
              <Button size="sm" disabled={!projectId} onClick={writeCool18ToHandbookDraft}>
                写入手册草稿
              </Button>
              <Button
                disabled={!projectId}
                onClick={() =>
                  projectId &&
                  void runAgentFeedback(projectId, "struct.face_slap", {
                    label: "struct.face_slap",
                  })
                }
              >
                打脸三阶（L6）
              </Button>
            </div>
          </div>
        )}
        {tab === "curve" && (
          <div className="stack" style={{ marginTop: 10 }}>
            <p className="muted" style={{ marginTop: 0 }}>
              -10～+10；开篇常偏低，3 集小爽 / 10 集中爽 / 20 集大爽。圆点叠加了分集大纲里的付费点 / 卡点 / 情绪峰。
            </p>
            <EmotionCurve data={curvePoints} domain={[-10, 10]} height={220} />
            <div className="row" style={{ flexWrap: "wrap", gap: 8, fontSize: 11 }}>
              <span className="badge" style={{ color: CHART_COLORS[3] }}>● 付费点</span>
              <span className="badge" style={{ color: CHART_COLORS[4] }}>● 卡点</span>
              <span className="badge" style={{ color: CHART_COLORS[2] }}>● 情绪峰</span>
            </div>
            <Button
              disabled={!projectId}
              onClick={() => projectId && void runAgentFeedback(projectId, "ip.emotion_quant", { label: "ip.emotion_quant" })}
            >
              情绪量化体检
            </Button>
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
}

type DialogueLine = {
  speaker: string;
  attitude: string;
  info: string;
  subtext: string;
  raw: string;
};

/** 台词三层：态度 / 信息 / 潜台词 */
export function DialogueTripleWorkbench({
  projectId,
  artifacts,
}: {
  projectId?: string;
  artifacts?: Artifact[];
}) {
  const [lines, setLines] = usePersistedState<DialogueLine[]>(projectId, "dialogue-triple", [
    { speaker: "主角", attitude: "", info: "", subtext: "", raw: "" },
    { speaker: "对手", attitude: "", info: "", subtext: "", raw: "" },
  ]);

  // 旧版持久化数据可能缺字段，渲染前归一化，避免 l.attitude.trim() 对 undefined 崩溃。
  const safeLines: DialogueLine[] = useMemo(
    () =>
      (Array.isArray(lines) ? lines : []).map((l) => ({
        speaker: String(l?.speaker ?? ""),
        attitude: String(l?.attitude ?? ""),
        info: String(l?.info ?? ""),
        subtext: String(l?.subtext ?? ""),
        raw: String(l?.raw ?? ""),
      })),
    [lines],
  );

  const okCount = safeLines.filter((l) => l.attitude.trim() && l.info.trim()).length;

  return (
    <CollapsibleSection
      title="台词三层法（态度 · 信息 · 潜台词）"
      storageKey={projectId ? `deep-${projectId}-dialogue` : undefined}
      actions={
        <div className="row" style={{ gap: 6 }}>
          <Badge tone={okCount >= 1 ? "ok" : "warn"}>已拆 {okCount} 句</Badge>
          <Button
            disabled={!projectId}
            onClick={() =>
              projectId &&
              void runAgentFeedback(projectId, "prose.dialogue_formula", { label: "prose.dialogue_formula", inputJson: { lines } })
            }
          >
            三层公式改写
          </Button>
          <Button
            variant="primary"
            disabled={!projectId}
            onClick={() =>
              projectId &&
              void runAgentFeedback(projectId, "prose.dialogue_pressure", { label: "prose.dialogue_pressure", inputJson: { lines } })
            }
          >
            短狠毒加压
          </Button>
        </div>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        每句至少两层：态度（对谁/什么态度）+ 信息（推进情节）+ 潜台词（真正想说的）。禁止说明书对白。
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>角色</th>
            <th>原句</th>
            <th>态度</th>
            <th>信息</th>
            <th>潜台词</th>
          </tr>
        </thead>
        <tbody>
          {safeLines.map((l, i) => (
            <tr key={i}>
              <td>
                <input
                  className="input"
                  value={l.speaker}
                  onChange={(e) =>
                    setLines((rows) =>
                      rows.map((r, j) => (j === i ? { ...r, speaker: e.target.value } : r)),
                    )
                  }
                />
              </td>
              {(
                [
                  ["raw", "原句"],
                  ["attitude", "态度"],
                  ["info", "信息"],
                  ["subtext", "潜台词"],
                ] as const
              ).map(([k]) => (
                <td key={k}>
                  <input
                    className="input"
                    value={l[k]}
                    onChange={(e) =>
                      setLines((rows) =>
                        rows.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)),
                      )
                    }
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: 8 }}>
        <Button
          size="sm"
          onClick={() =>
            setLines((rows) => [
              ...rows,
              { speaker: "", attitude: "", info: "", subtext: "", raw: "" },
            ])
          }
        >
          加一行
        </Button>
      </div>
      {artifacts?.some((a) => a.type === "manuscript") && (
        <p className="muted" style={{ marginTop: 8 }}>
          可从正文分镜台词粘贴到「原句」列再拆三层。
        </p>
      )}
    </CollapsibleSection>
  );
}

const LEGACY_BEAT_FUNCS = new Set([
  "建置",
  "辩论",
  "进入第二幕",
  "B 故事",
  "游戏玩耍",
  "中点",
  "坏人逼近",
  "一无所有",
  "灵魂黑夜",
  "进入第三幕",
  "结局",
]);

function normalizeBeatRows(raw: unknown): CharlieBeatRow[] {
  const defaults = defaultCharlieBeatRows();
  if (!Array.isArray(raw) || raw.length !== 20) return defaults;
  return defaults.map((d, i) => {
    const r = raw[i] as Record<string, unknown> | undefined;
    if (!r) return d;
    const legacyName = String(r.function ?? r.name ?? "");
    const name =
      legacyName &&
      !LEGACY_BEAT_FUNCS.has(legacyName) &&
      CHARLIE_BEAT20.some((b) => b.name === legacyName)
        ? legacyName
        : d.name;
    return {
      ...d,
      name,
      conflict: String(r.conflict ?? ""),
      emotion: String(r.emotion ?? ""),
      payHint: Boolean(r.payHint ?? r.pay ?? d.payHint),
      intensity: Number(r.intensity ?? 3) || 3,
    };
  });
}

/** 短剧 20 节拍：查理拍名（起承转合），≠ Save-the-Cat 默认行 */
export function Beat20Workbench({ projectId }: { projectId?: string }) {
  const [rows, setRows] = usePersistedState<CharlieBeatRow[]>(
    projectId,
    "beat20-charlie",
    defaultCharlieBeatRows(),
  );
  useEffect(() => {
    setRows((prev) => normalizeBeatRows(prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  const filled = rows.filter((r) => r.conflict.trim()).length;
  const mid = rows[9];

  return (
    <CollapsibleSection
      title="二十节拍（查理短剧）"
      storageKey={projectId ? `deep-${projectId}-beat20-charlie` : undefined}
      actions={
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <Badge tone={filled >= 16 ? "ok" : "warn"}>{filled}/20 有冲突</Badge>
          <Button
            disabled={!projectId}
            onClick={() =>
              projectId &&
              void runAgentFeedback(projectId, "struct.midpoint", { label: "struct.midpoint" })
            }
          >
            中点五型
          </Button>
          <Button
            disabled={!projectId}
            onClick={() =>
              projectId &&
              void runAgentFeedback(projectId, "struct.paywall", { label: "struct.paywall" })
            }
          >
            付费点地图
          </Button>
          <Button
            disabled={!projectId}
            onClick={() =>
              projectId &&
              void runAgentFeedback(projectId, "struct.bridge8", { label: "struct.bridge8" })
            }
          >
            八桥段
          </Button>
          <Button
            variant="primary"
            disabled={!projectId}
            onClick={() =>
              projectId &&
              void runAgentFeedback(projectId, "struct.beat20", {
                label: "struct.beat20",
                inputJson: {
                  beats: rows.map((r) => ({
                    n: r.no,
                    name: r.name,
                    act: r.act,
                    beat: r.conflict,
                    emotion: r.emotion,
                    intensity: r.intensity,
                  })),
                },
              })
            }
          >
            生成 / 加固 Beat1–20
          </Button>
        </div>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        查理 20 拍：起1–5 / 承6–10 / 转11–15 / 合16–20。Beat10=故事拐点。≠ 漫剧 Kartian；≠
        Save-the-Cat。当前拐点：{mid?.name || "—"} · {mid?.conflict || "待写"}
      </p>
      <div style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>段</th>
              <th>节拍</th>
              <th>冲突推进</th>
              <th>情绪/爽点</th>
              <th>强度</th>
              <th>付费意识</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={r.no}
                style={r.no === 10 ? { background: "var(--bg-elevated, transparent)" } : undefined}
              >
                <td>{r.no}</td>
                <td>
                  <Badge>{r.act}</Badge>
                </td>
                <td>
                  <input
                    className="input"
                    value={r.name}
                    title={CHARLIE_BEAT20[i]?.tip}
                    onChange={(e) =>
                      setRows((all) =>
                        all.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    className="input"
                    value={r.conflict}
                    onChange={(e) =>
                      setRows((all) =>
                        all.map((x, j) => (j === i ? { ...x, conflict: e.target.value } : x)),
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    className="input"
                    value={r.emotion}
                    onChange={(e) =>
                      setRows((all) =>
                        all.map((x, j) => (j === i ? { ...x, emotion: e.target.value } : x)),
                      )
                    }
                  />
                </td>
                <td>
                  <span
                    style={{
                      display: "inline-block",
                      minWidth: 22,
                      textAlign: "center",
                      fontWeight: 700,
                      color:
                        (r.intensity ?? 3) >= 4
                          ? "#e5484d"
                          : (r.intensity ?? 3) >= 3
                            ? "#f5a524"
                            : "#8a8f98",
                      background:
                        (r.intensity ?? 3) >= 4
                          ? "rgba(229,72,77,.15)"
                          : (r.intensity ?? 3) >= 3
                            ? "rgba(245,165,36,.15)"
                            : "rgba(138,143,152,.12)",
                      borderRadius: 6,
                      padding: "2px 6px",
                    }}
                  >
                    {r.intensity ?? 3}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    className="badge"
                    onClick={() =>
                      setRows((all) =>
                        all.map((x, j) => (j === i ? { ...x, payHint: !x.payHint } : x)),
                      )
                    }
                    style={{
                      cursor: "pointer",
                      borderColor: r.payHint ? "#e5484d" : undefined,
                      color: r.payHint ? "#e5484d" : undefined,
                      opacity: r.payHint ? 1 : 0.5,
                    }}
                    title="点击切换付费点标记"
                  >
                    {r.payHint ? "付费点" : "普通"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CollapsibleSection>
  );
}

type PitchForm = {
  title: string;
  genre: string;
  gender: string;
  episodes: string;
  wordsPerEp: string;
  sellPoint: string;
  benchmark: string;
  authorNote: string;
  logline: string;
  platform: string;
  formatNotes: string;
};

const PITCH_FIELDS: { key: keyof PitchForm; label: string; ph?: string; full?: boolean }[] = [
  { key: "title", label: "作品名" },
  { key: "genre", label: "题材" },
  { key: "gender", label: "频向" },
  { key: "episodes", label: "规划集数" },
  { key: "wordsPerEp", label: "每集字数" },
  { key: "platform", label: "投稿平台" },
  { key: "sellPoint", label: "卖点", full: true },
  { key: "benchmark", label: "对标气质（勿抄袭）", full: true },
  { key: "logline", label: "导语（冲突+爽点+欲望）", full: true },
  { key: "authorNote", label: "作者简介", full: true },
  { key: "formatNotes", label: "制作规格备注（景数/擦边边界等）", full: true },
];

/** 投稿信息表 + 导语 + 导出 */
export function PitchSpecWorkbench({
  projectId,
  hasHook,
  hasBio,
  outlineCount,
  bodyCount,
  synopsis,
  artifacts,
  projectTitle,
  format = "manju",
}: {
  projectId?: string;
  hasHook: boolean;
  hasBio: boolean;
  outlineCount: number;
  bodyCount: number;
  synopsis?: string;
  artifacts?: Artifact[];
  projectTitle?: string;
  format?: ProjectFormat;
}) {
  const outlineTarget = format === "manju" || format === "duanju" ? 10 : 1;
  const bodyTarget = format === "duanju" ? 10 : format === "manju" ? 3 : 1;
  const episodesDefault =
    format === "duanju" || format === "manju"
      ? "10"
      : format === "ip_adapt"
        ? "24"
        : format === "short_novel"
          ? "30"
          : "100";
  const wordsDefault =
    format === "short_novel" || format === "male_long" || format === "female_long"
      ? "2000–3000"
      : "800–1200";
  const outlineLabel =
    format === "duanju"
      ? "十集大纲"
      : format === "short_novel"
        ? "章纲细纲"
        : format === "male_long" || format === "female_long"
          ? "卷纲章纲"
          : format === "ip_adapt"
            ? "单元故事表"
            : "分集大纲";
  const bodyLabel =
    format === "duanju"
      ? "分场剧本"
      : format === "short_novel"
        ? "正文成稿"
        : format === "male_long" || format === "female_long"
          ? "样章"
          : format === "ip_adapt"
            ? "压缩剧本"
            : "分集正文";
  // v2：默认值按格式（集数/字数档）修正，旧 key 里存的是 800–1200 漫剧默认的泄漏值
  const [form, setForm] = usePersistedState<PitchForm>(projectId, "pitch-spec-v2", {
    title: projectTitle ?? "",
    genre: "",
    gender: "男频",
    episodes: episodesDefault,
    wordsPerEp: wordsDefault,
    sellPoint: "",
    benchmark: "",
    authorNote: "",
    logline: synopsis || "",
    platform: "",
    formatNotes: "",
  });
  const fields = PITCH_FIELDS.map((f) =>
    f.key === "episodes"
      ? { ...f, ph: episodesDefault }
      : f.key === "wordsPerEp"
        ? { ...f, ph: wordsDefault }
        : f,
  );
  useEffect(() => {
    if (projectTitle) setForm(previous => previous.title.trim() ? previous : {...previous, title: projectTitle});
  }, [projectTitle, projectId, setForm]);
  const [ipRights, setIpRights] = usePersistedState(
    projectId,
    "pitch-ip-rights",
    { copyrightConfirmed: false, platformAcceptsAdapt: false },
  );

  useEffect(() => {
    if (format !== "ip_adapt" || !projectId) return;
    try {
      const raw = localStorage.getItem(`deep:${projectId}:ip-adapt-wf`);
      if (!raw) return;
      const wf = JSON.parse(raw) as {
        select?: { copyrightConfirmed?: boolean; platformAcceptsAdapt?: boolean };
      };
      if (!wf.select) return;
      setIpRights((s) => ({
        copyrightConfirmed: Boolean(wf.select?.copyrightConfirmed ?? s.copyrightConfirmed),
        platformAcceptsAdapt: Boolean(
          wf.select?.platformAcceptsAdapt ?? s.platformAcceptsAdapt,
        ),
      }));
    } catch {
      /* ignore */
    }
  }, [format, projectId, setIpRights]);

  const pack = useMemo(
    () => [
      {
        title: format === "manju" ? "核心梗" : "故事梗概",
        ready: format === "manju" ? hasHook : Boolean(synopsis?.trim()),
      },
      { title: "人物小传", ready: hasBio },
      { title: outlineLabel, ready: outlineCount >= outlineTarget, detail: `${outlineCount}/${outlineTarget}` },
      { title: bodyLabel, ready: bodyCount >= bodyTarget, detail: `${bodyCount}/${bodyTarget}` },
    ],
    [
      format,
      hasHook,
      synopsis,
      hasBio,
      outlineCount,
      bodyCount,
      outlineLabel,
      outlineTarget,
      bodyLabel,
      bodyTarget,
    ],
  );
  const readyCount = pack.filter((p) => p.ready).length;
  const formOk = form.title.trim() && form.logline.trim() && form.sellPoint.trim();

  const exportText = () => {
    const md = [
      `# 《${form.title || "未命名"}》投稿包`,
      "",
      "## 信息表",
      ...PITCH_FIELDS.map((f) => `- ${f.label}：${form[f.key] || "（待补）"}`),
      "",
      "## 四件套状态",
      ...pack.map((p) => `- ${p.title}：${p.ready ? "就绪" : "缺失"}${p.detail ? ` (${p.detail})` : ""}`),
    ].join("\n");
    void navigator.clipboard?.writeText(md);
  };

  const exportPack = async (fmt: ExportFormat) => {
    if (!projectId) {
      toast.info("缺少项目，无法导出");
      return;
    }
    const sections: ExportSection[] = [
      {
        heading: "作品信息",
        body: PITCH_FIELDS.map((f) => `${f.label}：${form[f.key] || "（待补）"}`).join("\n"),
      },
      {
        heading: "交稿物状态",
        body: pack
          .map((p) => `${p.title}：${p.ready ? "就绪" : "缺失"}${p.detail ? ` (${p.detail})` : ""}`)
          .join("\n"),
      },
    ];
    const logline = form.logline.trim() || synopsis?.trim() || "";
    if (logline) {
      sections.push({
        heading: format === "manju" ? "一句话梗概" : "故事梗概",
        body: logline,
      });
    }
    const hooks = (artifacts ?? []).filter((a) => a.type === "core_hook");
    const adoptedHook = hooks.find((h) => h.status === "adopted") ?? hooks[0];
    if (adoptedHook) {
      const hookText = hookBodyOf(adoptedHook);
      if (hookText.trim()) sections.push({ heading: "核心梗", body: hookText });
    }
    const characters = (artifacts ?? []).filter((a) => a.type === "character");
    characters.forEach((c, index) => {
      const text = characterBodyOf(c);
      if (text.trim()) {
        sections.push({
          heading: `人物小传 · ${c.title || `角色 ${index + 1}`}`,
          body: text,
        });
      }
    });
    const outlines = (artifacts ?? [])
      .filter((a) => a.type === "episode_outline")
      .sort((a, b) => episodeNoOf(a) - episodeNoOf(b));
    const outlineText = outlines
      .map((o) => outlineBodyOf(o))
      .filter((t) => t.trim())
      .join("\n\n");
    if (outlineText) sections.push({ heading: outlineLabel, body: outlineText });
    const manuscripts = (artifacts ?? [])
      .filter((a) => (format === "duanju" ? a.type === "scene" : a.type === "manuscript"))
      .sort((a, b) => episodeNoOf(a) - episodeNoOf(b));
    const unitWord =
      format === "short_novel" || format === "male_long" || format === "female_long"
        ? "章"
        : "集";
    sections.push(...manuscriptExportSections(manuscripts, bodyLabel, unitWord));
    try {
      const filename = await downloadExport(
        projectId,
        projectTitle || form.title || "投稿包",
        sections,
        fmt,
      );
      toast.ok(`已导出 ${filename}`);
    } catch (e) {
      toast.fail(e instanceof Error ? e.message : "导出失败");
    }
  };

  return (
    <div className="stack">
      <CollapsibleSection
        title="投稿信息与导语"
        storageKey={projectId ? `deep-${projectId}-pitch` : undefined}
        actions={
          <div className="row" style={{ gap: 6 }}>
            <Badge tone={readyCount === 4 ? "ok" : "warn"}>
              稿件 {readyCount}/{pack.length} · {formOk ? "投稿信息已齐" : "待补投稿信息"}
            </Badge>
            <Button size="sm" onClick={exportText}>
              复制 Markdown
            </Button>
            <Button size="sm" disabled={!projectId} onClick={() => void exportPack("txt")}>
              导出 TXT
            </Button>
            <Button size="sm" disabled={!projectId} onClick={() => void exportPack("docx")}>
              导出 DOCX
            </Button>
            <Button size="sm" disabled={!projectId} onClick={() => void exportPack("pdf")}>
              导出 PDF
            </Button>
            <Button
              disabled={!projectId}
              onClick={() =>
                projectId &&
                void runAgentFeedback(projectId, "topic.logline_title", { label: "topic.logline_title", inputJson: { draft: form.logline },
                })
              }
            >
              {format === "ip_adapt" ? "生成导语候选" : "生成导语候选"}
            </Button>
            <Button
              variant="primary"
              disabled={!projectId || readyCount < 4}
              onClick={() =>
                projectId &&
                void runAgentFeedback(projectId, "deliver.pitch_pack", { label: "deliver.pitch_pack", inputJson: form })
              }
            >
              生成投稿包
            </Button>
            {format === "duanju" ? (
              <Button
                disabled={!projectId}
                onClick={() =>
                  projectId &&
                  void runAgentFeedback(projectId, "deliver.submission_pack", { label: "deliver.submission_pack", inputJson: form })
                }
              >
                短剧交稿包
              </Button>
            ) : null}
          </div>
        }
      >
        <p className="muted" style={{ marginTop: 0 }}>
          作品名、梗概和卖点用于完成投稿信息表。导语写清谁遇到了什么难题，以及这个故事为什么值得看。其余资料可按投稿平台要求补充。
          {format === "ip_adapt"
            ? " 改编作品还需核对原作授权和接稿平台。"
            : ""}
        </p>
        {format === "ip_adapt" ? (
          <div className="stack" style={{ gap: 6, marginBottom: 8 }}>
            <label className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={ipRights.copyrightConfirmed}
                onChange={(e) =>
                  setIpRights((s) => ({ ...s, copyrightConfirmed: e.target.checked }))
                }
              />
              <span style={{ fontSize: 12 }}>版权已确认</span>
            </label>
            <label className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={ipRights.platformAcceptsAdapt}
                onChange={(e) =>
                  setIpRights((s) => ({ ...s, platformAcceptsAdapt: e.target.checked }))
                }
              />
              <span style={{ fontSize: 12 }}>对方收改编</span>
            </label>
          </div>
        ) : null}
        <div className="field-grid">
          {fields.map((f) => (
            <label
              key={f.key}
              className="field"
              style={f.full ? { gridColumn: "1 / -1" } : undefined}
            >
              <span>{f.label} · {["title", "logline", "sellPoint"].includes(f.key) ? "表单必填" : "选填"}</span>
              {f.full ? (
                <textarea
                  className="textarea"
                  rows={f.key === "logline" || f.key === "formatNotes" ? 3 : 2}
                  value={form[f.key]}
                  placeholder={f.ph}
                  onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                />
              ) : f.key === "gender" ? (
                <Select
                  className="select"
                  value={form.gender}
                  onChange={(e) => setForm((s) => ({ ...s, gender: e.target.value }))}
                >
                  <option>男频</option>
                  <option>女频</option>
                </Select>
              ) : (
                <input
                  className="input"
                  value={form[f.key]}
                  placeholder={f.ph}
                  onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                />
              )}
            </label>
          ))}
        </div>
      </CollapsibleSection>
    </div>
  );
}

/** 伏笔台账（接 foreshadow_ledger） */
export function ForesightWorkbench({ projectId }: { projectId?: string }) {
  const [rows, setRows] = usePersistedState<
    { bury: string; hook: string; payoff: string; status: string }[]
  >(projectId, "foreshadow", [
    { bury: "1", hook: "", payoff: "", status: "open" },
  ]);

  return (
    <CollapsibleSection
      title="伏笔 / 钩子台账"
      storageKey={projectId ? `deep-${projectId}-foresight` : undefined}
      actions={
        <div className="row" style={{ gap: 6 }}>
          <Button
            disabled={!projectId}
            onClick={() => projectId && void runAgentFeedback(projectId, "struct.expectation", { label: "struct.expectation" })}
          >
            期待感诊断
          </Button>
          <Button
            variant="primary"
            disabled={!projectId}
            onClick={() =>
              projectId &&
              void runAgentFeedback(projectId, "hook.foreshadow_ledger", { label: "hook.foreshadow_ledger", inputJson: { rows } })
            }
          >
            台账审计
          </Button>
        </div>
      }
    >
      <table className="table">
        <thead>
          <tr>
            <th>埋点集</th>
            <th>伏笔</th>
            <th>回收集</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {(["bury", "hook", "payoff", "status"] as const).map((k) => (
                <td key={k}>
                  <input
                    className="input"
                    value={r[k]}
                    onChange={(e) =>
                      setRows((all) =>
                        all.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)),
                      )
                    }
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <Button
        size="sm"
        style={{ marginTop: 8 }}
        onClick={() =>
          setRows((all) => [...all, { bury: "", hook: "", payoff: "", status: "open" }])
        }
      >
        加一行
      </Button>
    </CollapsibleSection>
  );
}
