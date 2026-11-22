/**
 * 狂更猫男频长篇引擎：选题顺序闸 / 五段简介 / 主线≠核心 / 不卡文十条 /
 * 循环倒推 / 搭台子 / 番茄里程碑 / 明暗牌。复用 male.* Agents，不另起 format。
 */
import {
  ANTI_STUCK_TEN_LABELS,
  MALE_LONG_KGM_CHECKPOINTS,
  MaleLongEngineWorkflowSchema,
  maleLongEngineCompleteness,
  patchMasterFromMaleLongEngine,
  validateBlurbFiveParts,
  validateLoopPlan,
  validateMainlineCoreGate,
  validateTitleFourQ,
  validateTopicOrderGate,
  type MaleLongEngineWorkflow,
  type MasterOutlineBody,
} from "@xiezuomanju/domain";
import { Badge, Button, Panel, Tabs } from "@xiezuomanju/ui";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import type { Hotspot } from "@xiezuomanju/domain";
import { runAgentFeedback } from "./runAgentFeedback";
import { usePersistedState } from "./usePersistedState";

export function emptyMaleLongEngine(): MaleLongEngineWorkflow {
  return MaleLongEngineWorkflowSchema.parse({});
}

const ARC_LABELS = ["起", "承", "转", "合"] as const;
const GATE_LABELS: { key: keyof MaleLongEngineWorkflow["topicOrderGate"]; label: string }[] = [
  { key: "scanRank", label: "扫榜" },
  { key: "titleDone", label: "书名" },
  { key: "blurbDone", label: "简介" },
  { key: "openingDone", label: "开头" },
  { key: "firstShowDone", label: "首秀" },
];
const MILESTONE_LABELS: {
  key: keyof Omit<MaleLongEngineWorkflow["platformMilestones"], "note">;
  label: string;
}[] = [
  { key: "daily4k", label: "日更≥4000" },
  { key: "signed", label: "签约" },
  { key: "firstShow", label: "首秀" },
  { key: "bookVolume", label: "书册" },
  { key: "chaseRatioOk", label: "追更比" },
  { key: "finishReadOk", label: "完读" },
];

/** 番茄/网文平台规则速查（狂更猫课内口径，发布前自查，以后台为准）。 */
const FANQIE_RULES: { group: string; items: string[] }[] = [
  {
    group: "账号与红线",
    items: [
      "身份证+手机+银行卡同一人；笔名难改，慎重起名",
      "扎更可能封号；断更超约 7 天可能停流，捡回需连更约 14 天",
      "严重抄袭封号；前三章太像、切入点/结构高度同质危险",
      "同一本书勿多平台同发；敏感热点勿凑",
    ],
  },
  {
    group: "更新与节点",
    items: [
      "日常约 4000 字，禁扎更；验证前连更 ≥3 天且每天 ≥4000",
      "签约约 2 万字；验证约 8 万字节奏（勿一次丢满）",
      "首秀常见约 10 万字；书测/书册约 20 万字",
    ],
  },
  {
    group: "数据口径",
    items: [
      "盯追更比（宜 ≤3:1）与完读（大众约 ≥15%），勿迷信书架比/催更数",
      "女频首秀起不来属正常；第一本锁 ≥20 万+书册，勿轻易切书",
      "番茄书名约 ≤15 字含标点",
    ],
  },
  {
    group: "书名与简介",
    items: [
      "书名 ≈ 题材 + 金手指 + 热词；四问：期待感/写得出/有矛盾/定位读者",
      "简介五段卖点：处境→画饼→路径→爽点预知→收束；勿堆「我是新人」",
    ],
  },
  {
    group: "同人与版权",
    items: [
      "同人核心是互动；删掉同人反应几乎没剩＝失败",
      "没版权硬写有法律风险；一稿多投必须告知",
    ],
  },
];

export function MaleLongEngineWorkbench({ projectId }: { projectId?: string }) {
  const [wf, setWf] = usePersistedState(
    projectId,
    "male-long-engine-wf",
    emptyMaleLongEngine(),
  );
  useEffect(() => {
    setWf((s) => MaleLongEngineWorkflowSchema.parse(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  const score = useMemo(() => maleLongEngineCompleteness(wf), [wf]);
  const [tab, setTab] = usePersistedState(projectId, "kgm-ml-tab", "overview");
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [hotspotsLoading, setHotspotsLoading] = useState(false);

  // 读回项目对标书（从热点建项目时写入 cover_meta.benchmark），自动勾「扫榜」
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void api
      .getProject(projectId)
      .then((p) => {
        if (cancelled) return;
        const b = p.coverMeta?.benchmark?.trim();
        if (b) {
          setWf((s) =>
            s.topicOrderGate.benchmarkTitle
              ? s
              : {
                  ...s,
                  topicOrderGate: {
                    ...s.topicOrderGate,
                    scanRank: true,
                    benchmarkTitle: b,
                    benchmarkSource: p.coverMeta?.platform || "",
                  },
                },
          );
        }
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const openPicker = () => {
    setShowPicker((v) => !v);
    if (!hotspots.length && !hotspotsLoading) {
      setHotspotsLoading(true);
      void api
        .listHotspots()
        .then(setHotspots)
        .finally(() => setHotspotsLoading(false));
    }
  };

  const pickBenchmark = (h: Hotspot) => {
    setWf((s) => ({
      ...s,
      topicOrderGate: {
        ...s.topicOrderGate,
        scanRank: true,
        benchmarkTitle: h.title,
        benchmarkSummary: h.summary,
        benchmarkSource: h.source,
        benchmarkGenre: h.genre,
      },
    }));
    setShowPicker(false);
  };

  const gate = validateTopicOrderGate(wf.topicOrderGate);
  const titleQ = validateTitleFourQ(wf.titleFourQ);
  const blurb = validateBlurbFiveParts(wf.blurbFiveParts);
  const mainCore = validateMainlineCoreGate(
    wf.mainlineOneLiner,
    wf.coreHighlightOneLiner,
    wf.fourArcCheck,
  );
  const loop = validateLoopPlan(wf.loopPlan);

  const syncThin = () => {
    if (!projectId) return;
    try {
      const key = `deep:${projectId}:master-outline`;
      const prev = localStorage.getItem(key);
      const base = (prev ? JSON.parse(prev) : {}) as MasterOutlineBody;
      localStorage.setItem(key, JSON.stringify(patchMasterFromMaleLongEngine(wf, base)));
    } catch {
      /* ignore */
    }
  };

  const ensureLoopChapters = (n = 15) => {
    setWf((s) => {
      const existing = [...s.loopPlan.chapters];
      while (existing.length < n) {
        existing.push({ chapterNo: existing.length + 1, function: "" });
      }
      return {
        ...s,
        loopPlan: { ...s.loopPlan, chapters: existing.slice(0, Math.max(n, existing.length)) },
      };
    });
  };

  const runOpening = () => {
    if (!projectId) return;
    if (gate.softBlockOpening) {
      window.alert(
        `选题顺序闸未齐（扫榜/书名/简介），male.opening 软阻：${gate.message}`,
      );
      return;
    }
    void runAgentFeedback(projectId, "male.opening", {
      label: "male.opening",
      inputJson: {
        mainline: wf.mainlineOneLiner,
        core_highlight: wf.coreHighlightOneLiner,
        blurb_five: wf.blurbFiveParts,
        benchmark: wf.topicOrderGate.benchmarkTitle
          ? {
              title: wf.topicOrderGate.benchmarkTitle,
              summary: wf.topicOrderGate.benchmarkSummary,
              genre: wf.topicOrderGate.benchmarkGenre,
              source: wf.topicOrderGate.benchmarkSource,
            }
          : undefined,
        topic_order_gate: wf.topicOrderGate,
      },
    });
  };

  const runUpgradeLoop = () => {
    if (!projectId) return;
    void runAgentFeedback(projectId, "male.upgrade_loop", {
      label: "male.upgrade_loop",
      inputJson: {
        core_hook: wf.coreHighlightOneLiner || wf.goldFingerBrief,
        hero_goal_now: wf.stageSetups[0]?.heroGoal || "",
        mainline_goal: wf.mainlineOneLiner || wf.loopPlan.endShock,
        gold_finger_rules: wf.goldFingerBrief,
        loop_index: wf.loopPlan.loopIndex,
        stuck_at_step: wf.antiStuck.currentStep,
        end_shock: wf.loopPlan.endShock,
        chapter_functions: wf.loopPlan.chapters,
      },
    });
  };

  return (
    <Panel
      title="狂更猫 · 男频长篇引擎"
      actions={
        <div className="row" style={{ gap: 6 }}>
          <Badge>
            {score.filledSteps}/{score.totalSteps}
          </Badge>
          {gate.softBlockOpening && <Badge tone="warn">opening 软阻</Badge>}
          <Button size="sm" onClick={syncThin}>
            回写摘要
          </Button>
        </div>
      }
    >
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        SOP：选题顺序闸、主线≠核心、不卡文十条、五段简介、循环倒推、搭台子、里程碑。复用
        male.*，不重建九格期待感/换元。
      </p>
      {score.missing.length > 0 && (
        <Badge tone="warn">未完成：{score.missing.join("、")}</Badge>
      )}
      <div className="row" style={{ flexWrap: "wrap", gap: 6, margin: "8px 0" }}>
        {MALE_LONG_KGM_CHECKPOINTS.map((cp, i) => (
          <button
            key={cp.id}
            type="button"
            className="btn btn-sm"
            style={{
              outline: wf.currentStep === i ? "2px solid var(--accent)" : undefined,
            }}
            onClick={() => setWf((s) => ({ ...s, currentStep: i }))}
            title={cp.userAction}
          >
            {cp.label}
          </button>
        ))}
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "总览" },
          { id: "gate", label: "顺序闸/书名简介" },
          { id: "maincore", label: "主线≠核心" },
          { id: "loop", label: "循环倒推" },
          { id: "stage", label: "搭台子" },
          { id: "antistuck", label: "不卡文十条" },
          { id: "misc", label: "明暗/里程碑" },
          { id: "rules", label: "平台规则" },
        ]}
      />

      {tab === "overview" && (
        <div className="stack" style={{ gap: 6 }}>
          <Badge tone={gate.ok ? "ok" : "warn"}>{gate.message}</Badge>
          <Badge tone={titleQ.ok ? "ok" : "warn"}>{titleQ.message}</Badge>
          <Badge tone={blurb.ok ? "ok" : "warn"}>{blurb.message}</Badge>
          <Badge tone={mainCore.ok ? "ok" : "warn"}>{mainCore.message}</Badge>
          <Badge tone={loop.ok ? "ok" : "warn"}>{loop.message}</Badge>
          <label className="field">
            <span>金手指简述</span>
            <textarea
              className="textarea"
              rows={2}
              value={wf.goldFingerBrief}
              onChange={(e) => setWf((s) => ({ ...s, goldFingerBrief: e.target.value }))}
            />
          </label>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <Button
              disabled={!projectId}
              onClick={() =>
                projectId &&
                void runAgentFeedback(projectId, "male.gold_finger", {
                  label: "male.gold_finger",
                  inputJson: {
                    gold_finger: wf.goldFingerBrief,
                    mainline: wf.mainlineOneLiner,
                    core_highlight: wf.coreHighlightOneLiner,
                  },
                })
              }
            >
              金手指体检
            </Button>
            <Button disabled={!projectId} onClick={runUpgradeLoop}>
              升级循环生成
            </Button>
            <Button disabled={!projectId} onClick={runOpening}>
              开头（顺序闸）
            </Button>
            <Button
              disabled={!projectId}
              onClick={() =>
                projectId &&
                void runAgentFeedback(projectId, "male.risk", {
                  label: "male.risk",
                  inputJson: { milestones: wf.platformMilestones },
                })
              }
            >
              风险软提示
            </Button>
          </div>
        </div>
      )}

      {tab === "gate" && (
        <div className="stack" style={{ gap: 8 }}>
          <strong style={{ fontSize: 13 }}>选题顺序闸（未齐软阻 opening）</strong>
          {GATE_LABELS.map(({ key, label }) => (
            <label key={key} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={Boolean(wf.topicOrderGate[key])}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    topicOrderGate: { ...s.topicOrderGate, [key]: e.target.checked },
                  }))
                }
              />
              <span style={{ fontSize: 12 }}>{label}</span>
            </label>
          ))}
          <strong style={{ fontSize: 13 }}>扫榜对标书</strong>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <Button size="sm" onClick={openPicker} disabled={!projectId}>
              {showPicker ? "收起热点榜" : "从热点榜带入对标"}
            </Button>
            {wf.topicOrderGate.benchmarkTitle && (
              <Badge tone="ok">{wf.topicOrderGate.benchmarkTitle}</Badge>
            )}
          </div>
          {showPicker && (
            <div
              className="stack"
              style={{ gap: 4, maxHeight: 180, overflow: "auto", paddingLeft: 4 }}
            >
              {hotspotsLoading && <div className="faint">加载热点…</div>}
              {!hotspotsLoading && hotspots.length === 0 && (
                <div className="faint">暂无热点，去「热点采集」开启数据源。</div>
              )}
              {hotspots.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  className="btn btn-sm"
                  style={{ textAlign: "left" }}
                  onClick={() => pickBenchmark(h)}
                  title={h.summary}
                >
                  {h.title}
                  <span className="faint" style={{ fontSize: 11 }}>
                    {" "}
                    · {h.genre} · {h.source}
                  </span>
                </button>
              ))}
            </div>
          )}
          {wf.topicOrderGate.benchmarkSummary && (
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              {wf.topicOrderGate.benchmarkSummary}
            </p>
          )}
          <strong style={{ fontSize: 13 }}>书名四问</strong>
          {(
            [
              ["q1Identity", "身份/人设"],
              ["q2Conflict", "冲突"],
              ["q3Promise", "承诺/爽点"],
              ["q4Diff", "差异化"],
              ["candidateTitle", "候选书名"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="field">
              <span>{l}</span>
              <input
                className="input"
                value={wf.titleFourQ[k]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    titleFourQ: { ...s.titleFourQ, [k]: e.target.value },
                  }))
                }
              />
            </label>
          ))}
          <strong style={{ fontSize: 13 }}>五段简介</strong>
          {(
            [
              ["situation", "处境"],
              ["piePromise", "画饼"],
              ["path", "路径"],
              ["close", "收束"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="field">
              <span>{l}</span>
              <textarea
                className="textarea"
                rows={2}
                value={wf.blurbFiveParts[k]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    blurbFiveParts: { ...s.blurbFiveParts, [k]: e.target.value },
                  }))
                }
              />
            </label>
          ))}
          <label className="field">
            <span>爽点预知（1–3，换行）</span>
            <textarea
              className="textarea"
              rows={3}
              value={wf.blurbFiveParts.coolPreview.join("\n")}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  blurbFiveParts: {
                    ...s.blurbFiveParts,
                    coolPreview: e.target.value.split("\n").filter((x) => x.trim()),
                  },
                }))
              }
            />
          </label>
        </div>
      )}

      {tab === "maincore" && (
        <div className="stack" style={{ gap: 8 }}>
          <Badge tone={mainCore.ok ? "ok" : "warn"}>{mainCore.message}</Badge>
          <label className="field">
            <span>主线一句话（终点/震惊）</span>
            <textarea
              className="textarea"
              rows={2}
              value={wf.mainlineOneLiner}
              onChange={(e) => setWf((s) => ({ ...s, mainlineOneLiner: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>核心亮点一句话（≠主线）</span>
            <textarea
              className="textarea"
              rows={2}
              value={wf.coreHighlightOneLiner}
              onChange={(e) =>
                setWf((s) => ({ ...s, coreHighlightOneLiner: e.target.value }))
              }
            />
          </label>
          <strong style={{ fontSize: 13 }}>四弧勾选</strong>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {ARC_LABELS.map((l, i) => (
              <label key={l} className="row" style={{ gap: 4 }}>
                <input
                  type="checkbox"
                  checked={wf.fourArcCheck[i]}
                  onChange={(e) =>
                    setWf((s) => {
                      const next = [...s.fourArcCheck] as [
                        boolean,
                        boolean,
                        boolean,
                        boolean,
                      ];
                      next[i] = e.target.checked;
                      return { ...s, fourArcCheck: next };
                    })
                  }
                />
                <span style={{ fontSize: 12 }}>{l}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {tab === "loop" && (
        <div className="stack" style={{ gap: 8 }}>
          <Badge tone={loop.ok ? "ok" : "warn"}>{loop.message}</Badge>
          <div className="row" style={{ gap: 8 }}>
            <label className="field">
              <span>循环序号</span>
              <input
                className="input"
                type="number"
                min={1}
                value={wf.loopPlan.loopIndex}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    loopPlan: {
                      ...s.loopPlan,
                      loopIndex: Math.max(1, Number(e.target.value) || 1),
                    },
                  }))
                }
              />
            </label>
            <Button size="sm" onClick={() => ensureLoopChapters(15)}>
              铺 15 章位
            </Button>
          </div>
          <label className="field">
            <span>循环终点震惊点 endShock</span>
            <textarea
              className="textarea"
              rows={2}
              value={wf.loopPlan.endShock}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  loopPlan: { ...s.loopPlan, endShock: e.target.value },
                }))
              }
            />
          </label>
          {wf.loopPlan.chapters.map((ch, idx) => (
            <label key={ch.chapterNo} className="field">
              <span>第 {ch.chapterNo} 章功能</span>
              <input
                className="input"
                value={ch.function}
                onChange={(e) =>
                  setWf((s) => {
                    const chapters = [...s.loopPlan.chapters];
                    chapters[idx] = { ...chapters[idx], function: e.target.value };
                    return { ...s, loopPlan: { ...s.loopPlan, chapters } };
                  })
                }
              />
            </label>
          ))}
          <Button disabled={!projectId} onClick={runUpgradeLoop}>
            喂 male.upgrade_loop
          </Button>
        </div>
      )}

      {tab === "stage" && (
        <div className="stack" style={{ gap: 8 }}>
          <Button
            size="sm"
            onClick={() =>
              setWf((s) => ({
                ...s,
                stageSetups: [
                  ...s.stageSetups,
                  {
                    chapterHint: "",
                    heroGoal: "",
                    foeGoals: [],
                    povFirst: "",
                    scenePurpose: "",
                  },
                ],
              }))
            }
          >
            加一章搭台子
          </Button>
          {wf.stageSetups.map((st, idx) => (
            <div
              key={idx}
              className="stack"
              style={{
                gap: 6,
                padding: 8,
                border: "1px solid var(--border, #ddd)",
              }}
            >
              <strong style={{ fontSize: 12 }}>搭台子 #{idx + 1}</strong>
              {(
                [
                  ["chapterHint", "章提示"],
                  ["heroGoal", "主角目标"],
                  ["povFirst", "先写谁的 POV"],
                  ["scenePurpose", "本场目的"],
                ] as const
              ).map(([k, l]) => (
                <label key={k} className="field">
                  <span>{l}</span>
                  <input
                    className="input"
                    value={st[k]}
                    onChange={(e) =>
                      setWf((s) => {
                        const stageSetups = [...s.stageSetups];
                        stageSetups[idx] = { ...stageSetups[idx], [k]: e.target.value };
                        return { ...s, stageSetups };
                      })
                    }
                  />
                </label>
              ))}
              <label className="field">
                <span>对手目标（换行）</span>
                <textarea
                  className="textarea"
                  rows={2}
                  value={st.foeGoals.join("\n")}
                  onChange={(e) =>
                    setWf((s) => {
                      const stageSetups = [...s.stageSetups];
                      stageSetups[idx] = {
                        ...stageSetups[idx],
                        foeGoals: e.target.value.split("\n").filter((x) => x.trim()),
                      };
                      return { ...s, stageSetups };
                    })
                  }
                />
              </label>
              {projectId && (
                <Button
                  size="sm"
                  onClick={() =>
                    void runAgentFeedback(projectId, "scene.solution_fanout", {
                      label: "scene.solution_fanout",
                      inputJson: { stage_setup: st },
                    })
                  }
                >
                  链 solution_fanout
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "antistuck" && (
        <div className="stack" style={{ gap: 8 }}>
          <p className="muted" style={{ fontSize: 12 }}>
            卡文只推下一步；当前步高亮并传入 stuck_at_step。
          </p>
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {ANTI_STUCK_TEN_LABELS.map((label, i) => {
              const step = i + 1;
              const active = wf.antiStuck.currentStep === step;
              return (
                <button
                  key={label}
                  type="button"
                  className="btn btn-sm"
                  style={{
                    outline: active ? "2px solid var(--accent)" : undefined,
                    fontWeight: active ? 600 : undefined,
                  }}
                  onClick={() =>
                    setWf((s) => ({
                      ...s,
                      antiStuck: { ...s.antiStuck, currentStep: step },
                    }))
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
          <label className="field">
            <span>当前步备注（追加一行）</span>
            <textarea
              className="textarea"
              rows={3}
              value={wf.antiStuck.notes.join("\n")}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  antiStuck: {
                    ...s.antiStuck,
                    notes: e.target.value.split("\n"),
                  },
                }))
              }
            />
          </label>
          <Button disabled={!projectId} onClick={runUpgradeLoop}>
            按 stuck_at_step={wf.antiStuck.currentStep} 推下一步
          </Button>
        </div>
      )}

      {tab === "misc" && (
        <div className="stack" style={{ gap: 8 }}>
          <strong style={{ fontSize: 13 }}>明暗牌（轻挂，不另开期待感引擎）</strong>
          {(
            [
              ["mingIdentity", "明牌身份"],
              ["anIdentity", "暗牌身份"],
              ["payoffBeat", "兑现节拍"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="field">
              <span>{l}</span>
              <input
                className="input"
                value={wf.mingAn[k]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    mingAn: { ...s.mingAn, [k]: e.target.value },
                  }))
                }
              />
            </label>
          ))}
          <strong style={{ fontSize: 13 }}>平台里程碑（人工勾，不接番茄 API）</strong>
          {MILESTONE_LABELS.map(({ key, label }) => (
            <label key={key} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={Boolean(wf.platformMilestones[key])}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    platformMilestones: {
                      ...s.platformMilestones,
                      [key]: e.target.checked,
                    },
                  }))
                }
              />
              <span style={{ fontSize: 12 }}>{label}</span>
            </label>
          ))}
          <label className="field">
            <span>备忘</span>
            <textarea
              className="textarea"
              rows={2}
              value={wf.notes}
              onChange={(e) => setWf((s) => ({ ...s, notes: e.target.value }))}
            />
          </label>
        </div>
      )}

      {tab === "rules" && (
        <div className="stack" style={{ gap: 8 }}>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            番茄/网文发布前自查（狂更猫课内口径，一律以当期后台为准）。完整 58 条见知识库「番茄/网文平台规则速查库」。
          </p>
          {FANQIE_RULES.map((g) => (
            <div key={g.group}>
              <strong style={{ fontSize: 13 }}>{g.group}</strong>
              <ul style={{ margin: "4px 0 8px", paddingLeft: 18 }}>
                {g.items.map((it) => (
                  <li key={it} style={{ fontSize: 12 }}>
                    {it}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
