/**
 * 九格 11.md 漫剧管线深化 + 16.md 考拉深化（≠ male_long）。
 * 不重建 ManjuStage；链 Logline100 / CoolPoint / Pitch。
 */
import {
  COOL_EXPAND_COUNTS,
  EPISODE_RHYTHM_LABELS,
  MANJU_FEMALE_GENRE_POOL,
  MANJU_MALE_GENRE_POOL,
  MANJU_PIPELINE_CHECKPOINTS,
  ManjuPipelineWorkflowSchema,
  manjuHandbookOpsCompleteness,
  manjuKoalaCompleteness,
  manjuPipelineWorkflowCompleteness,
  parseCoolExpandToEvents,
  summarizeManjuHandbookToMaster,
  summarizeManjuPipelineToMaster,
  validateCoarseOutline,
  validateDialogueHarshChecklist,
  validateEpisodeRhythm,
  validateExtendForm,
  validateLoglineSocial,
  validateMarketGenreAck,
  validateOutlinePerEpReview,
  validatePitchEthics,
  validatePromptTrimAck,
  validateRejectThree,
  validateScriptFormatGate,
  type CoolExpandCount,
  type EpisodeRhythmBand,
  type ManjuPipelineWorkflow,
  type MasterOutlineBody,
  type RollingMilestone,
} from "@xiezuomanju/domain";
import { Badge, Button, Panel, Tabs } from "@xiezuomanju/ui";
import { Select } from "@xiezuomanju/ui";
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { runAgentFeedback } from "./runAgentFeedback";
import { usePersistedState } from "./usePersistedState";

const KOALA_12_LABELS = [
  "频道定位",
  "提示词删减",
  "一主一辅工具",
  "100字/四件套",
  "人设先于大纲",
  "粗纲排序",
  "十集大纲校正",
  "滚动交稿里程碑",
  "正文改纲同步",
  "去AI五维",
  "投稿伦理",
  "拆剧功能卡",
] as const;

const ROLLING_LABELS: Record<RollingMilestone, string> = {
  pitch: "投稿四件套就绪（3+10）",
  post_10_30: "交10留30滚动",
  outline_60: "60集大纲蓄水",
};

export function emptyManjuPipeline(): ManjuPipelineWorkflow {
  return ManjuPipelineWorkflowSchema.parse({});
}

export function ManjuPipelineWorkbench({ projectId }: { projectId?: string }) {
  const [wf, setWf] = usePersistedState(projectId, "manju-pipeline-wf", emptyManjuPipeline());
  useEffect(() => {
    setWf((s) => ManjuPipelineWorkflowSchema.parse(s));
    // 旧持久化补齐 16.md 字段
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  const score = useMemo(() => manjuPipelineWorkflowCompleteness(wf), [wf]);
  const koala = useMemo(() => manjuKoalaCompleteness(wf), [wf]);
  const handbook = useMemo(
    () => manjuHandbookOpsCompleteness(wf.handbookOps ?? ManjuPipelineWorkflowSchema.parse({}).handbookOps),
    [wf.handbookOps],
  );
  const [tab, setTab] = usePersistedState(projectId, "mp-l11-tab", "overview");
  const ops = wf.handbookOps ?? ManjuPipelineWorkflowSchema.parse({}).handbookOps;
  const setOps = (updater: (o: typeof ops) => typeof ops) =>
    setWf((s) => ({
      ...s,
      handbookOps: updater(s.handbookOps ?? ManjuPipelineWorkflowSchema.parse({}).handbookOps),
    }));
  const social = validateLoglineSocial(wf.loglineSocial);
  const coarse = validateCoarseOutline(wf.coarse);
  const rhythm = validateEpisodeRhythm(wf.rhythm);
  const reject = validateRejectThree(wf.rejectThree);
  const ethics = validatePitchEthics(wf.ethics);
  const trim = validatePromptTrimAck(wf.promptTrimAck);
  const epReview = validateOutlinePerEpReview(wf.outlinePerEpReview);

  const koalaDoneFlags = useMemo(() => {
    const pack = wf.fourPackReady ? 1 : 0;
    return [
      trim.ok,
      trim.ok,
      wf.toolPairNoted,
      pack === 1 && social.ok,
      wf.bioBeforeOutlineNoted,
      coarse.ok,
      epReview.ok,
      wf.rollingMilestone !== "pitch" || wf.fourPackReady,
      wf.syncOutlineOnBodyEdit,
      reject.ok,
      ethics.ok,
      (wf.episodeFunctionCards?.length ?? 0) > 0,
    ];
  }, [wf, trim.ok, social.ok, coarse.ok, epReview.ok, reject.ok, ethics.ok]);

  const syncThin = () => {
    if (!projectId) return;
    try {
      const thin = summarizeManjuPipelineToMaster(wf);
      const key = `deep:${projectId}:master-outline`;
      const prev = localStorage.getItem(key);
      const base = prev ? (JSON.parse(prev) as MasterOutlineBody) : {};
      localStorage.setItem(key, JSON.stringify({ ...base, ...thin }));
    } catch {
      /* ignore */
    }
  };

  return (
    <Panel
      title="漫剧管线深化（11.md）+ 考拉（16.md）"
      actions={
        <div className="row" style={{ gap: 6 }}>
          <Badge>
            11:{score.filledSteps}/{score.totalSteps}
          </Badge>
          <Badge tone={koala.filledSteps >= 4 ? "ok" : "warn"}>
            考拉:{koala.filledSteps}/{koala.totalSteps}
          </Badge>
          <Badge tone={handbook.filledSteps >= 4 ? "ok" : "warn"}>
            手册:{handbook.filledSteps}/{handbook.totalSteps}
          </Badge>
          <Button size="sm" onClick={syncThin}>
            回写摘要
          </Button>
        </div>
      }
    >
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        权威 Stage 仍为人设先于大纲（考拉）。≠ 男频 long Stage。本台补粗纲/节奏/拒稿/伦理 + 16
        滚动交稿中间态。
      </p>
      <div className="stack" style={{ gap: 4, margin: "8px 0" }}>
        <strong style={{ fontSize: 12 }}>考拉十二步进度（只读）</strong>
        <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
          {KOALA_12_LABELS.map((label, i) => (
            <span
              key={label}
              className="badge"
              style={{
                fontSize: 10,
                opacity: koalaDoneFlags[i] ? 1 : 0.45,
                borderColor: koalaDoneFlags[i] ? "var(--ok, #2f7d58)" : undefined,
              }}
              title={label}
            >
              {i + 1}.{koalaDoneFlags[i] ? "✓" : "·"}
            </span>
          ))}
        </div>
        <div
          style={{
            height: 6,
            borderRadius: 3,
            background: "var(--border, #ddd)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${(koalaDoneFlags.filter(Boolean).length / 12) * 100}%`,
              background: "var(--accent)",
              transition: "width 0.2s",
            }}
          />
        </div>
        <Badge>{ROLLING_LABELS[wf.rollingMilestone]}</Badge>
      </div>
      {score.missing.length > 0 && (
        <Badge tone="warn">未完成：{score.missing.join("、")}</Badge>
      )}
      {koala.missing.length > 0 && (
        <Badge tone="warn">考拉缺：{koala.missing.join("、")}</Badge>
      )}
      <div className="row" style={{ flexWrap: "wrap", gap: 6, margin: "8px 0" }}>
        {MANJU_PIPELINE_CHECKPOINTS.map((cp, i) => (
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
            {i + 1}. {cp.label.replace(/^\d+\./, "")}
          </button>
        ))}
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "总览" },
          { id: "logline", label: "100字社交" },
          { id: "coarse", label: "粗纲" },
          { id: "rhythm", label: "集纲节奏" },
          { id: "reject", label: "拒稿/台词" },
          { id: "ethics", label: "伦理/四件套" },
          { id: "koala", label: "16考拉" },
          { id: "handbook", label: "手册SOP" },
          { id: "cards", label: "拆剧薄表" },
        ]}
      />
      {tab === "overview" && (
        <div className="stack" style={{ gap: 6 }}>
          <Badge tone={social.ok ? "ok" : "warn"}>{social.message}</Badge>
          <Badge tone={coarse.ok ? "ok" : "warn"}>{coarse.message}</Badge>
          <Badge tone={rhythm.ok ? "ok" : "warn"}>{rhythm.message}</Badge>
          <Badge tone={reject.ok ? "ok" : "warn"}>{reject.message}</Badge>
          <Badge tone={ethics.ok ? "ok" : "warn"}>{ethics.message}</Badge>
          <Badge tone={trim.ok ? "ok" : "warn"}>{trim.message}</Badge>
          <Badge tone={epReview.ok ? "ok" : "warn"}>{epReview.message}</Badge>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={wf.bioBeforeOutlineNoted}
              onChange={(e) =>
                setWf((s) => ({ ...s, bioBeforeOutlineNoted: e.target.checked }))
              }
            />
            <span style={{ fontSize: 12 }}>已确认：人设 BioAck 先于大纲（考拉权威）</span>
          </label>
        </div>
      )}
      {tab === "logline" && (
        <div className="stack" style={{ gap: 8 }}>
          <textarea
            className="textarea"
            rows={4}
            placeholder="100字梗概"
            value={wf.loglineSocial.text}
            onChange={(e) =>
              setWf((s) => ({
                ...s,
                loglineSocial: { ...s.loglineSocial, text: e.target.value },
              }))
            }
          />
          {(
            [
              ["toldFriend", "已讲给朋友听"],
              ["friendAudienceMatch", "朋友属目标受众"],
              ["passed", "对方听懂并感兴趣（通过）"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={wf.loglineSocial[k]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    loglineSocial: { ...s.loglineSocial, [k]: e.target.checked },
                  }))
                }
              />
              <span style={{ fontSize: 12 }}>{l}</span>
            </label>
          ))}
        </div>
      )}
      {tab === "coarse" && (
        <CoarseExpandTab projectId={projectId} wf={wf} setWf={setWf} />
      )}
      {tab === "rhythm" && (
        <div className="stack" style={{ gap: 8 }}>
          {wf.rhythm.slots.map((slot, i) => (
            <label key={slot.band} className="field">
              <span>{EPISODE_RHYTHM_LABELS[slot.band as EpisodeRhythmBand]}</span>
              <textarea
                className="textarea"
                rows={2}
                value={slot.plan}
                onChange={(e) => {
                  const slots = [...wf.rhythm.slots];
                  slots[i] = { ...slot, plan: e.target.value, done: Boolean(e.target.value.trim()) };
                  setWf((s) => ({ ...s, rhythm: { ...s.rhythm, slots } }));
                }}
              />
            </label>
          ))}
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={wf.rhythm.naturalLanguageOutline}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  rhythm: { ...s.rhythm, naturalLanguageOutline: e.target.checked },
                }))
              }
            />
            <span style={{ fontSize: 12 }}>集纲用自然语言（非格式化提纲）</span>
          </label>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={wf.rhythm.noQiChengZhuanHePrompt}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  rhythm: { ...s.rhythm, noQiChengZhuanHePrompt: e.target.checked },
                }))
              }
            />
            <span style={{ fontSize: 12 }}>已删「起承转合」提示词</span>
          </label>
        </div>
      )}
      {tab === "reject" && (
        <div className="stack" style={{ gap: 8 }}>
          {(
            [
              ["noNovelization", "无小说化"],
              ["noLiveActionThinking", "无实拍思维"],
              ["noHomogenization", "无同质化"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={wf.rejectThree[k]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    rejectThree: { ...s.rejectThree, [k]: e.target.checked },
                  }))
                }
              />
              <span style={{ fontSize: 12 }}>{l}</span>
            </label>
          ))}
          <strong style={{ fontSize: 13 }}>台词 13 条（轻勾）</strong>
          {wf.dialogue13.checks.map((c, i) => (
            <label key={c.id} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={c.done}
                onChange={(e) => {
                  const checks = [...wf.dialogue13.checks];
                  checks[i] = { ...c, done: e.target.checked };
                  setWf((s) => ({ ...s, dialogue13: { ...s.dialogue13, checks } }));
                }}
              />
              <span style={{ fontSize: 12 }}>{c.label}</span>
            </label>
          ))}
        </div>
      )}
      {tab === "ethics" && (
        <div className="stack" style={{ gap: 8 }}>
          {(
            [
              ["onePitchOneOutlet", "一稿一投"],
              ["confidentialityNoted", "保密已注意"],
              ["homeworkSeparatedFromPitch", "作业与已投稿分离"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={wf.ethics[k]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    ethics: { ...s.ethics, [k]: e.target.checked },
                  }))
                }
              />
              <span style={{ fontSize: 12 }}>{l}</span>
            </label>
          ))}
          <label className="field">
            <span>收益模式（软提示）</span>
            <Select
              className="select"
              value={wf.ethics.revenueMode}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  ethics: {
                    ...s.ethics,
                    revenueMode: e.target.value as ManjuPipelineWorkflow["ethics"]["revenueMode"],
                  },
                }))
              }
            >
              <option value="unknown">未定</option>
              <option value="guarantee">保底</option>
              <option value="share">分成</option>
              <option value="buyout">买断</option>
            </Select>
          </label>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={wf.fourPackReady}
              onChange={(e) => setWf((s) => ({ ...s, fourPackReady: e.target.checked }))}
            />
            <span style={{ fontSize: 12 }}>四件套就绪（链 Pitch 台）</span>
          </label>
        </div>
      )}
      {tab === "koala" && (
        <div className="stack" style={{ gap: 10 }}>
          <p className="muted" style={{ fontSize: 11, margin: 0 }}>
            16.md 考拉小灶：三层删减 → 十集逐集校正 → 滚动交稿（3+10 / 10+30 / 60）。≠ male_long。
          </p>
          <strong style={{ fontSize: 13 }}>提示词三层删减</strong>
          {(
            [
              ["genderTrim", "按频道/性别删减"],
              ["subGenreTrim", "按子题材删减"],
              ["platformTrim", "按平台删减"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={wf.promptTrimAck[k]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    promptTrimAck: { ...s.promptTrimAck, [k]: e.target.checked },
                  }))
                }
              />
              <span style={{ fontSize: 12 }}>{l}</span>
            </label>
          ))}
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={wf.toolPairNoted}
              onChange={(e) => setWf((s) => ({ ...s, toolPairNoted: e.target.checked }))}
            />
            <span style={{ fontSize: 12 }}>已确认一主一辅工具对</span>
          </label>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={wf.syncOutlineOnBodyEdit}
              onChange={(e) =>
                setWf((s) => ({ ...s, syncOutlineOnBodyEdit: e.target.checked }))
              }
            />
            <span style={{ fontSize: 12 }}>改正文必同步改提纲（去 AI 旁强调）</span>
          </label>
          <label className="field">
            <span>滚动交稿里程碑</span>
            <Select
              className="select"
              value={wf.rollingMilestone}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  rollingMilestone: e.target.value as RollingMilestone,
                }))
              }
            >
              <option value="pitch">pitch · 3+10 投稿就绪</option>
              <option value="post_10_30">post_10_30 · 交10留30</option>
              <option value="outline_60">outline_60 · 60集大纲蓄水</option>
            </Select>
          </label>
          <p className="muted" style={{ fontSize: 11, margin: 0 }}>
            当前：{ROLLING_LABELS[wf.rollingMilestone]}
          </p>
          <strong style={{ fontSize: 13 }}>十集大纲逐集校正</strong>
          <div className="stack" style={{ gap: 4 }}>
            {(wf.outlinePerEpReview ?? []).map((row, i) => (
              <div key={row.ep} className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: 12, width: 36 }}>Ep{row.ep}</span>
                <label className="row" style={{ gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={row.coolOk}
                    onChange={(e) => {
                      const outlinePerEpReview = [...wf.outlinePerEpReview];
                      outlinePerEpReview[i] = { ...row, coolOk: e.target.checked };
                      setWf((s) => ({ ...s, outlinePerEpReview }));
                    }}
                  />
                  <span style={{ fontSize: 11 }}>爽点</span>
                </label>
                <label className="row" style={{ gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={row.crisisOk}
                    onChange={(e) => {
                      const outlinePerEpReview = [...wf.outlinePerEpReview];
                      outlinePerEpReview[i] = { ...row, crisisOk: e.target.checked };
                      setWf((s) => ({ ...s, outlinePerEpReview }));
                    }}
                  />
                  <span style={{ fontSize: 11 }}>危机</span>
                </label>
                <label className="row" style={{ gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={row.done}
                    onChange={(e) => {
                      const outlinePerEpReview = [...wf.outlinePerEpReview];
                      outlinePerEpReview[i] = { ...row, done: e.target.checked };
                      setWf((s) => ({ ...s, outlinePerEpReview }));
                    }}
                  />
                  <span style={{ fontSize: 11 }}>校正完</span>
                </label>
              </div>
            ))}
          </div>
          <Button
            size="sm"
            onClick={() =>
              setWf((s) => ({
                ...s,
                outlinePerEpReview: s.outlinePerEpReview.map((r) => ({
                  ...r,
                  coolOk: true,
                  crisisOk: true,
                  done: true,
                })),
              }))
            }
          >
            十集全勾（自检后用）
          </Button>
        </div>
      )}
      {tab === "handbook" && (
        <div className="stack" style={{ gap: 10 }}>
          <p className="muted" style={{ fontSize: 11, margin: 0 }}>
            实操手册 SOP 中间态（嵌 Pipeline，不另建 Stage）。缺：{handbook.missing.join("、") || "无"}
          </p>
          <Badge tone={validateMarketGenreAck(ops.marketGenreAck).ok ? "ok" : "warn"}>
            {validateMarketGenreAck(ops.marketGenreAck).message}
          </Badge>
          <strong style={{ fontSize: 13 }}>男频题材池</strong>
          <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
            {MANJU_MALE_GENRE_POOL.map((g) => {
              const on = ops.marketGenreAck.maleGenres.includes(g);
              return (
                <button
                  key={g}
                  type="button"
                  className="badge"
                  style={on ? { borderColor: "var(--accent)" } : undefined}
                  onClick={() =>
                    setOps((o) => ({
                      ...o,
                      marketGenreAck: {
                        ...o.marketGenreAck,
                        maleGenres: on
                          ? o.marketGenreAck.maleGenres.filter((x) => x !== g)
                          : [...o.marketGenreAck.maleGenres, g],
                      },
                    }))
                  }
                >
                  {g}
                </button>
              );
            })}
          </div>
          <strong style={{ fontSize: 13 }}>女频题材池</strong>
          <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
            {MANJU_FEMALE_GENRE_POOL.map((g) => {
              const on = ops.marketGenreAck.femaleGenres.includes(g);
              return (
                <button
                  key={g}
                  type="button"
                  className="badge"
                  style={on ? { borderColor: "var(--accent)" } : undefined}
                  onClick={() =>
                    setOps((o) => ({
                      ...o,
                      marketGenreAck: {
                        ...o.marketGenreAck,
                        femaleGenres: on
                          ? o.marketGenreAck.femaleGenres.filter((x) => x !== g)
                          : [...o.marketGenreAck.femaleGenres, g],
                      },
                    }))
                  }
                >
                  {g}
                </button>
              );
            })}
          </div>
          <strong style={{ fontSize: 13 }}>注意事项六勾</strong>
          {(
            [
              ["brainHole", "脑洞向/强噱头"],
              ["strongConflict", "开局强冲突"],
              ["coolTrope", "爽文套路/装逼打脸"],
              ["fastPace", "节奏要快"],
              ["payoffEarly", "爆点前置"],
              ["sinkAudience", "下沉市场受众"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={ops.marketGenreAck[k]}
                onChange={(e) =>
                  setOps((o) => ({
                    ...o,
                    marketGenreAck: { ...o.marketGenreAck, [k]: e.target.checked },
                  }))
                }
              />
              <span style={{ fontSize: 12 }}>{l}</span>
            </label>
          ))}
          <strong style={{ fontSize: 13 }}>核心梗多轮（十个不行二十个）</strong>
          <Button
            size="sm"
            onClick={() =>
              setOps((o) => ({
                ...o,
                hookBatchRounds: [
                  ...o.hookBatchRounds,
                  {
                    round: o.hookBatchRounds.length + 1,
                    count: 10,
                    keepIds: [],
                    note: "",
                  },
                ],
              }))
            }
          >
            记一轮批量
          </Button>
          {ops.hookBatchRounds.map((r, i) => (
            <div key={r.round} className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12 }}>第{r.round}轮</span>
              <input
                className="input"
                type="number"
                style={{ width: 72 }}
                value={r.count}
                onChange={(e) => {
                  const hookBatchRounds = [...ops.hookBatchRounds];
                  hookBatchRounds[i] = { ...r, count: Number(e.target.value) || 0 };
                  setOps((o) => ({ ...o, hookBatchRounds }));
                }}
              />
              <input
                className="input"
                placeholder="备注/留下的梗"
                value={r.note}
                onChange={(e) => {
                  const hookBatchRounds = [...ops.hookBatchRounds];
                  hookBatchRounds[i] = { ...r, note: e.target.value };
                  setOps((o) => ({ ...o, hookBatchRounds }));
                }}
              />
            </div>
          ))}
          <strong style={{ fontSize: 13 }}>前十「能不能用」轮次</strong>
          <Button
            size="sm"
            onClick={() =>
              setOps((o) => ({
                ...o,
                ep10TableAccept: [
                  ...o.ep10TableAccept,
                  { round: o.ep10TableAccept.length + 1, accepted: false, note: "" },
                ],
              }))
            }
          >
            加核对轮
          </Button>
          {ops.ep10TableAccept.map((r, i) => (
            <label key={r.round} className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12 }}>轮{r.round}</span>
              <input
                type="checkbox"
                checked={r.accepted}
                onChange={(e) => {
                  const ep10TableAccept = [...ops.ep10TableAccept];
                  ep10TableAccept[i] = { ...r, accepted: e.target.checked };
                  setOps((o) => ({ ...o, ep10TableAccept }));
                }}
              />
              <span style={{ fontSize: 12 }}>可以用</span>
              <input
                className="input"
                placeholder="表格↔文字核对备注"
                value={r.note}
                onChange={(e) => {
                  const ep10TableAccept = [...ops.ep10TableAccept];
                  ep10TableAccept[i] = { ...r, note: e.target.value };
                  setOps((o) => ({ ...o, ep10TableAccept }));
                }}
              />
            </label>
          ))}
          <strong style={{ fontSize: 13 }}>剧本规格闸</strong>
          <Badge tone={validateScriptFormatGate(ops.scriptFormatGate).ok ? "ok" : "warn"}>
            {validateScriptFormatGate(ops.scriptFormatGate).message}
          </Badge>
          {(
            [
              ["wordBand800_1200", "字数 800–1200"],
              ["scenesMax3", "场景 ≤3"],
              ["dialogueMax500", "台词含旁白 ≤500"],
              ["sceneHeaderFormat", "场头格式（日夜/内外/地点/人物）"],
              ["deNovelizeAck", "去小说化→分镜画面+台词"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={ops.scriptFormatGate[k]}
                onChange={(e) =>
                  setOps((o) => ({
                    ...o,
                    scriptFormatGate: { ...o.scriptFormatGate, [k]: e.target.checked },
                  }))
                }
              />
              <span style={{ fontSize: 12 }}>{l}</span>
            </label>
          ))}
          <strong style={{ fontSize: 13 }}>台词要狠（旁挂三层公式）</strong>
          <Badge
            tone={validateDialogueHarshChecklist(ops.dialogueHarshChecklist).ok ? "ok" : "warn"}
          >
            {validateDialogueHarshChecklist(ops.dialogueHarshChecklist).message}
          </Badge>
          {(
            [
              ["shortHarsh", "短促有力"],
              ["barbedHook", "带刺带钩"],
              ["contrastShock", "反差冲击"],
              ["evidenceSlap", "证据甩脸"],
              ["crowdReaction", "围观者反应"],
              ["pacePingPong", "快交锋节奏"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={ops.dialogueHarshChecklist[k]}
                onChange={(e) =>
                  setOps((o) => ({
                    ...o,
                    dialogueHarshChecklist: {
                      ...o.dialogueHarshChecklist,
                      [k]: e.target.checked,
                    },
                  }))
                }
              />
              <span style={{ fontSize: 12 }}>{l}</span>
            </label>
          ))}
          <strong style={{ fontSize: 13 }}>扩纲表单</strong>
          <Badge tone={validateExtendForm(ops.extendForm).ok ? "ok" : "warn"}>
            {validateExtendForm(ops.extendForm).message}
          </Badge>
          <div className="field-grid">
            <label className="field">
              <span>集起</span>
              <input
                className="input"
                type="number"
                value={ops.extendForm.blockFrom}
                onChange={(e) =>
                  setOps((o) => ({
                    ...o,
                    extendForm: {
                      ...o.extendForm,
                      blockFrom: Number(e.target.value) || 11,
                    },
                  }))
                }
              />
            </label>
            <label className="field">
              <span>集止</span>
              <input
                className="input"
                type="number"
                value={ops.extendForm.blockTo}
                onChange={(e) =>
                  setOps((o) => ({
                    ...o,
                    extendForm: {
                      ...o.extendForm,
                      blockTo: Number(e.target.value) || 20,
                    },
                  }))
                }
              />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>冲突升级</span>
              <input
                className="input"
                value={ops.extendForm.conflictUpgrade}
                onChange={(e) =>
                  setOps((o) => ({
                    ...o,
                    extendForm: { ...o.extendForm, conflictUpgrade: e.target.value },
                  }))
                }
              />
            </label>
          </div>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={ops.extendForm.foreshadowSync}
              onChange={(e) =>
                setOps((o) => ({
                  ...o,
                  extendForm: { ...o.extendForm, foreshadowSync: e.target.checked },
                }))
              }
            />
            <span style={{ fontSize: 12 }}>伏笔已同步复盘</span>
          </label>
          <label className="field">
            <span>扩纲能不能用</span>
            <Select
              className="select"
              value={ops.extendForm.humanVerdict}
              onChange={(e) =>
                setOps((o) => ({
                  ...o,
                  extendForm: {
                    ...o.extendForm,
                    humanVerdict: e.target.value as typeof o.extendForm.humanVerdict,
                  },
                }))
              }
            >
              <option value="pending">待定</option>
              <option value="reject">不能用</option>
              <option value="accept">可以用</option>
            </Select>
          </label>
          {ops.pickedCool18Draft.length > 0 && (
            <Badge>草稿爽点：{ops.pickedCool18Draft.join("·")}</Badge>
          )}
          <Button
            size="sm"
            onClick={() => {
              if (!projectId) return;
              try {
                const thin = summarizeManjuHandbookToMaster(ops);
                const key = `deep:${projectId}:master-outline`;
                const prev = localStorage.getItem(key);
                const base = prev ? (JSON.parse(prev) as MasterOutlineBody) : {};
                localStorage.setItem(key, JSON.stringify({ ...base, ...thin }));
              } catch {
                /* ignore */
              }
            }}
          >
            回写手册摘要
          </Button>
        </div>
      )}
      {tab === "cards" && (
        <div className="stack" style={{ gap: 8 }}>
          <p className="muted" style={{ fontSize: 11, margin: 0 }}>
            瑞林拆剧功能卡（薄表）：集号/段/功能标签。可挂 KB，不新建虚假 Agent。
          </p>
          <Button
            size="sm"
            onClick={() =>
              setWf((s) => ({
                ...s,
                episodeFunctionCards: [
                  ...s.episodeFunctionCards,
                  {
                    id: `fc-${Date.now()}`,
                    episodeNo: s.episodeFunctionCards.length + 1,
                    segment: 1,
                    functionLabel: "",
                    note: "",
                  },
                ],
              }))
            }
          >
            加功能卡
          </Button>
          {(wf.episodeFunctionCards ?? []).map((card, i) => (
            <div key={card.id} className="field-grid">
              <label className="field">
                <span>集号</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={card.episodeNo}
                  onChange={(e) => {
                    const episodeFunctionCards = [...wf.episodeFunctionCards];
                    episodeFunctionCards[i] = {
                      ...card,
                      episodeNo: Number(e.target.value) || 1,
                    };
                    setWf((s) => ({ ...s, episodeFunctionCards }));
                  }}
                />
              </label>
              <label className="field">
                <span>段</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={card.segment}
                  onChange={(e) => {
                    const episodeFunctionCards = [...wf.episodeFunctionCards];
                    episodeFunctionCards[i] = {
                      ...card,
                      segment: Number(e.target.value) || 1,
                    };
                    setWf((s) => ({ ...s, episodeFunctionCards }));
                  }}
                />
              </label>
              <label className="field" style={{ gridColumn: "1 / -1" }}>
                <span>功能标签</span>
                <input
                  className="input"
                  value={card.functionLabel}
                  placeholder="建期待 / 爽点兑现 / 钩子…"
                  onChange={(e) => {
                    const episodeFunctionCards = [...wf.episodeFunctionCards];
                    episodeFunctionCards[i] = {
                      ...card,
                      functionLabel: e.target.value,
                    };
                    setWf((s) => ({ ...s, episodeFunctionCards }));
                  }}
                />
              </label>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function CoarseExpandTab({
  projectId,
  wf,
  setWf,
}: {
  projectId?: string;
  wf: ManjuPipelineWorkflow;
  setWf: Dispatch<SetStateAction<ManjuPipelineWorkflow>>;
}) {
  const [paste, setPaste] = useState("");
  const [coreHook, setCoreHook] = useState("");
  const count = (wf.coarse.lastExpandCount || 10) as CoolExpandCount;

  const importParsed = (text: string, replace: boolean) => {
    const parsed = parseCoolExpandToEvents(text, {
      startOrder: replace ? 0 : wf.coarse.events.length,
    });
    if (!parsed.length) return;
    setWf((s) => ({
      ...s,
      coarse: {
        ...s.coarse,
        events: replace ? parsed : [...s.coarse.events, ...parsed],
        sorted: false,
      },
    }));
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="muted" style={{ fontSize: 11, margin: 0 }}>
        {wf.coarse.note} · 复用 <code>struct.cool_expand</code> 灌池，不重建爽点引擎；
        <code>struct.cool18</code> 仍做逐集选型。
      </p>
      <label className="field">
        <span>核心梗（灌池种子）</span>
        <textarea
          className="textarea"
          rows={2}
          value={coreHook}
          onChange={(e) => setCoreHook(e.target.value)}
          placeholder="粘贴已采纳核心梗…"
        />
      </label>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <label className="field">
          <span>条数</span>
          <Select
            className="select"
            value={count}
            onChange={(e) =>
              setWf((s) => ({
                ...s,
                coarse: {
                  ...s.coarse,
                  lastExpandCount: Number(e.target.value) as CoolExpandCount,
                },
              }))
            }
          >
            {COOL_EXPAND_COUNTS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </label>
        <Button
          size="sm"
          variant="primary"
          disabled={!projectId || !coreHook.trim()}
          onClick={() =>
            projectId &&
            void runAgentFeedback(projectId, "struct.cool_expand", {
              label: "struct.cool_expand",
              inputJson: {
                core_hook: coreHook,
                count,
                existing_events: wf.coarse.events.map((e) => e.label),
              },
            })
          }
        >
          AI 批量扩写事件池
        </Button>
        <Button
          size="sm"
          onClick={() =>
            setWf((s) => ({
              ...s,
              coarse: {
                ...s.coarse,
                events: [
                  ...s.coarse.events,
                  {
                    id: `e-${Date.now()}`,
                    label: "",
                    kind: "cool",
                    selected: true,
                    order: s.coarse.events.length,
                    bridgeNote: "",
                  },
                ],
              },
            }))
          }
        >
          手加事件
        </Button>
      </div>
      <label className="field">
        <span>粘贴 Agent 输出 → 解析导入粗纲</span>
        <textarea
          className="textarea"
          rows={4}
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder={"| 1 | abuse | … |\n1. [爽] …"}
        />
      </label>
      <div className="row" style={{ gap: 8 }}>
        <Button size="sm" disabled={!paste.trim()} onClick={() => importParsed(paste, false)}>
          追加导入
        </Button>
        <Button size="sm" disabled={!paste.trim()} onClick={() => importParsed(paste, true)}>
          覆盖导入
        </Button>
        <Badge>池内 {wf.coarse.events.length} 条</Badge>
      </div>
      {wf.coarse.events.map((ev, i) => (
        <div key={ev.id} className="field-grid">
          <label className="field">
            <span>标签</span>
            <input
              className="input"
              value={ev.label}
              onChange={(e) => {
                const events = [...wf.coarse.events];
                events[i] = { ...ev, label: e.target.value };
                setWf((s) => ({ ...s, coarse: { ...s.coarse, events } }));
              }}
            />
          </label>
          <label className="field">
            <span>类型</span>
            <Select
              className="select"
              value={ev.kind}
              onChange={(e) => {
                const events = [...wf.coarse.events];
                events[i] = {
                  ...ev,
                  kind: e.target.value as "abuse" | "cool" | "twist",
                };
                setWf((s) => ({ ...s, coarse: { ...s.coarse, events } }));
              }}
            >
              <option value="abuse">虐</option>
              <option value="cool">爽</option>
              <option value="twist">转</option>
            </Select>
          </label>
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span>衔接</span>
            <input
              className="input"
              value={ev.bridgeNote}
              onChange={(e) => {
                const events = [...wf.coarse.events];
                events[i] = { ...ev, bridgeNote: e.target.value };
                setWf((s) => ({ ...s, coarse: { ...s.coarse, events } }));
              }}
            />
          </label>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={ev.selected}
              onChange={(e) => {
                const events = [...wf.coarse.events];
                events[i] = { ...ev, selected: e.target.checked };
                setWf((s) => ({ ...s, coarse: { ...s.coarse, events } }));
              }}
            />
            <span style={{ fontSize: 12 }}>选用</span>
          </label>
        </div>
      ))}
      <label className="row" style={{ gap: 6 }}>
        <input
          type="checkbox"
          checked={wf.coarse.sorted}
          onChange={(e) =>
            setWf((s) => ({
              ...s,
              coarse: { ...s.coarse, sorted: e.target.checked },
            }))
          }
        />
        <span style={{ fontSize: 12 }}>已确认排序</span>
      </label>
    </div>
  );
}
