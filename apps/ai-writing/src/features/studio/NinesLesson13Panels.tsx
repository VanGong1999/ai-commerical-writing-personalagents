/**
 * 九格 13.md IP 改编台：选书→锚定→导语五要素→单元/情绪→压缩→节奏→视听→AdaptPitchPack。
 * 复用 ip.* Stage；≠ 漫剧 PitchFourPack。深化：预算条/结构尺/情绪轨迹/三源同步。
 */
import {
  deriveAdaptBudget,
  deriveAdaptPitchPack,
  IP_ADAPT_CHECKPOINTS,
  IP_TOMATO_REF,
  IP_UNSUITABLE_TYPES,
  ipAdaptWorkflowCompleteness,
  summarizeIpAdaptToMaster,
  tomatoRefWarn,
  unitEmotionTrail,
  validateAdaptAnchor,
  validateAdaptPitchPack,
  validateIpSelectGoNoGo,
  validatePaywallEmotionCut,
  validateUnitEmotionTrail,
  type IpAdaptWorkflow,
  type MasterOutlineBody,
  type UnitCutRow,
} from "@xiezuomanju/domain";
import { Badge, Button, Panel, Tabs, toast } from "@xiezuomanju/ui";
import { useMemo, useState } from "react";
import { usePersistedState } from "./usePersistedState";

export function emptyIpAdaptWorkflow(): IpAdaptWorkflow {
  return {
    schemaVersion: "nines-13.md/1",
    currentStep: 0,
    select: {
      dataOk: false,
      genreOk: false,
      structureFriendly: false,
      characterOk: false,
      structureChecks: {
        burstEvery5to10: false,
        strongConflict: false,
        actionHeavy: false,
        visualStrong: false,
        paceFast: false,
      },
      readsApprox: 0,
      commentsApprox: 0,
      ratingApprox: 0,
      finishRateOk: false,
      unsuitableHits: [],
      copyrightConfirmed: false,
      platformAcceptsAdapt: false,
      note: "四指标重点：结构友好+人物；番茄参考阈值仅人工填",
    },
    budget: {
      sourceWords: 0,
      chapterCount: 0,
      targetEpisodes: 60,
      batchFrom: 1,
      batchTo: 20,
    },
    anchor: {
      mainGoal: "",
      corePersona: "",
      goldFinger: "",
      worldRules: "",
      canCutSide: true,
      canMergeSupport: true,
      canReorder: true,
      canFrontloadCool: true,
    },
    logline: {
      identity: "",
      coreConflict: "",
      turnChance: "",
      goldFinger: "",
      openConflict: "",
      dilemma: "",
      coreContradict: "",
      turnHook: "",
      powerGap: "",
    },
    units: [],
    rebuild: {
      mergeConflict: false,
      timeSkip: false,
      coolFront: false,
      cutPsychology: false,
      mergeChars: false,
      ironTriangle: false,
      cutEnv: false,
      cutRepeat: false,
      keepImportantSide: false,
      epOpen: "",
      epCarry: "",
      epSlap: "",
    },
    rhythm: {
      minutesPerEp: 2,
      conflictIn3s: false,
      pushEvery30s: false,
      first5sAction: "",
      sameBeatMax30s: false,
      paywallEp10: false,
      paywallEp20: false,
      cutAtEmotionLow: false,
      cutBeforeTwist: false,
      note: "断章优先情绪峰值；≠查理短剧主线卡点",
    },
    av: {
      policyOk: false,
      performanceOk: false,
      aiGeneratable: false,
      costSceneOk: false,
      platformPrefOk: false,
    },
    pitchPack: {
      anchorDone: false,
      unitCount: 0,
      emotionPoints: 0,
      scriptCount: 0,
    },
    notes: "",
  };
}

/** 解析 ip.unit_cut / emotion_quant 类 YAML 片段 → 单元行 */
export function parseIpUnitsFromYaml(raw: string): UnitCutRow[] {
  const text = raw.trim();
  if (!text) return [];
  const blocks = text.split(/\n(?=-\s|^\s*id:)/m).filter((b) => b.trim());
  const rows: UnitCutRow[] = [];
  const pick = (block: string, key: string) => {
    const m = block.match(new RegExp(`${key}\\s*:\\s*["']?([^"'\\n]+)`, "i"));
    return m?.[1]?.trim() ?? "";
  };
  const pickNum = (block: string, key: string, fallback: number) => {
    const v = pick(block, key);
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  for (const block of blocks.length ? blocks : [text]) {
    const id = pick(block, "id") || `u${Date.now()}-${rows.length}`;
    const conflict = pick(block, "conflict") || pick(block, "summary");
    const chapterFrom = pickNum(block, "chapter_from", pickNum(block, "chapterFrom", 1));
    const chapterTo = pickNum(block, "chapter_to", pickNum(block, "chapterTo", chapterFrom + 2));
    const emotionScore = pickNum(block, "emotion", pickNum(block, "emotionScore", -6));
    const trailRaw = pick(block, "emotion_trail") || pick(block, "emotionTrail");
    const emotionTrail = trailRaw
      ? trailRaw
          .split(/[,，\s]+/)
          .map(Number)
          .filter((n) => Number.isFinite(n))
      : [];
    const tight = !/tight\s*:\s*false/i.test(block);
    const keep = !/keep\s*:\s*false/i.test(block);
    if (!conflict && !pick(block, "id") && rows.length === 0 && !/- /.test(block)) {
      continue;
    }
    rows.push({
      id,
      chapterFrom: Math.max(1, chapterFrom),
      chapterTo: Math.max(chapterFrom, chapterTo),
      conflict,
      emotionScore,
      emotionTrail,
      tight,
      keep,
    });
  }
  return rows;
}

export function IpAdaptWorkbench({ projectId }: { projectId?: string }) {
  const [wf, setWf] = usePersistedState(projectId, "ip-adapt-wf", emptyIpAdaptWorkflow());
  const score = useMemo(() => ipAdaptWorkflowCompleteness(wf), [wf]);
  const [tab, setTab] = usePersistedState(projectId, "ip-l13-tab", "overview");
  const [yamlPaste, setYamlPaste] = useState("");
  const selectGate = validateIpSelectGoNoGo(wf.select);
  const anchorGate = validateAdaptAnchor(wf.anchor);
  const rhythmGate = validatePaywallEmotionCut(wf.rhythm);
  const packSynced = deriveAdaptPitchPack(wf);
  const packGate = validateAdaptPitchPack(packSynced);
  const budgetHints = deriveAdaptBudget(wf.budget);
  const tomatoMsg = tomatoRefWarn(wf.select);

  const syncThin = () => {
    if (!projectId) return;
    try {
      const thin = summarizeIpAdaptToMaster(wf);
      const key = `deep:${projectId}:master-outline`;
      const prev = localStorage.getItem(key);
      const base = prev ? (JSON.parse(prev) as MasterOutlineBody) : {};
      localStorage.setItem(key, JSON.stringify({ ...base, ...thin }));
    } catch {
      /* ignore */
    }
  };

  const syncSynopsisOut = () => {
    if (!projectId) return;
    try {
      const parts = {
        identity: wf.logline.identity,
        conflict: wf.logline.coreConflict,
        turn: wf.logline.turnChance,
        finger: wf.logline.goldFinger,
        powerGap: wf.logline.powerGap,
      };
      localStorage.setItem(`synopsis-parts:${projectId}`, JSON.stringify(parts));
      toast.ok("已同步梗概到 SynopsisParts");
    } catch {
      toast.fail("同步梗概失败");
    }
  };

  const syncSynopsisIn = () => {
    if (!projectId) return;
    try {
      const raw = localStorage.getItem(`synopsis-parts:${projectId}`);
      if (!raw) {
        toast.info("本地尚无 SynopsisParts");
        return;
      }
      const parts = JSON.parse(raw) as {
        identity?: string;
        conflict?: string;
        turn?: string;
        finger?: string;
        powerGap?: string;
      };
      setWf((s) => ({
        ...s,
        logline: {
          ...s.logline,
          identity: parts.identity ?? s.logline.identity,
          coreConflict: parts.conflict ?? s.logline.coreConflict,
          turnChance: parts.turn ?? s.logline.turnChance,
          goldFinger: parts.finger ?? s.logline.goldFinger,
          powerGap: parts.powerGap ?? s.logline.powerGap,
        },
      }));
      toast.ok("已从 Synopsis 拉入导语");
    } catch {
      toast.fail("读取 Synopsis 失败");
    }
  };

  const syncRightsOut = () => {
    if (!projectId) return;
    try {
      localStorage.setItem(
        `deep:${projectId}:pitch-ip-rights`,
        JSON.stringify({
          copyrightConfirmed: wf.select.copyrightConfirmed,
          platformAcceptsAdapt: wf.select.platformAcceptsAdapt,
        }),
      );
      toast.ok("已推送版权确认到 PitchSpec");
    } catch {
      toast.fail("推送失败");
    }
  };

  const importYaml = () => {
    const rows = parseIpUnitsFromYaml(yamlPaste);
    if (!rows.length) {
      toast.fail("未能解析出单元行");
      return;
    }
    setWf((s) => ({ ...s, units: [...s.units, ...rows] }));
    setYamlPaste("");
    toast.ok(`已导入 ${rows.length} 个单元`);
  };

  return (
    <Panel
      title="IP 改编台（13.md）"
      actions={
        <div className="row" style={{ gap: 6 }}>
          <Badge>
            {score.filledSteps}/{score.totalSteps}
          </Badge>
          <Button size="sm" onClick={syncSynopsisOut}>
            同步梗概→
          </Button>
          <Button size="sm" onClick={syncSynopsisIn}>
            ←拉入梗概
          </Button>
          <Button size="sm" onClick={syncRightsOut}>
            推送版权
          </Button>
          <Button size="sm" onClick={syncThin}>
            回写摘要
          </Button>
        </div>
      }
    >
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        减法→重构→落地；AdaptPitchPack（锚定+单元+情绪+剧本）≠ 漫剧 10+3。交稿计数由单元表派生。
      </p>
      {score.missing.length > 0 && (
        <Badge tone="warn">未完成：{score.missing.join("、")}</Badge>
      )}
      <div className="row" style={{ flexWrap: "wrap", gap: 6, margin: "8px 0" }}>
        {IP_ADAPT_CHECKPOINTS.map((cp, i) => (
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
          { id: "select", label: "选书/锚定" },
          { id: "logline", label: "导语五要素" },
          { id: "units", label: "单元/情绪" },
          { id: "rebuild", label: "压缩/节奏" },
          { id: "av", label: "视听/交稿" },
        ]}
      />
      {tab === "overview" && (
        <div className="stack" style={{ gap: 6 }}>
          <Badge tone={selectGate.level === "fail" ? "fail" : selectGate.ok ? "ok" : "warn"}>
            {selectGate.message}
          </Badge>
          {tomatoMsg && <Badge tone="warn">{tomatoMsg}</Badge>}
          <Badge tone={anchorGate.ok ? "ok" : "warn"}>{anchorGate.message}</Badge>
          <Badge tone={rhythmGate.ok ? "ok" : "warn"}>{rhythmGate.message}</Badge>
          <Badge tone={packGate.ok ? "ok" : "warn"}>{packGate.message}</Badge>
          <strong style={{ fontSize: 13 }}>压缩预算条</strong>
          <div className="field-grid">
            {(
              [
                ["sourceWords", "原文字数"],
                ["chapterCount", "原章数"],
                ["targetEpisodes", "目标集数"],
                ["batchFrom", "批量起章"],
                ["batchTo", "批量止章"],
              ] as const
            ).map(([k, l]) => (
              <label key={k} className="field">
                <span>{l}</span>
                <input
                  className="input"
                  type="number"
                  value={wf.budget[k]}
                  onChange={(e) =>
                    setWf((s) => ({
                      ...s,
                      budget: { ...s.budget, [k]: Number(e.target.value) || 0 },
                    }))
                  }
                />
              </label>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            {budgetHints.compressHint} · {budgetHints.unitQuotaHint}
          </p>
          <p className="muted" style={{ fontSize: 11, margin: 0 }}>
            番茄参考尺：在读≥{IP_TOMATO_REF.reads.toLocaleString()} / 评论≥
            {IP_TOMATO_REF.comments.toLocaleString()} / 评分≥{IP_TOMATO_REF.rating}
          </p>
          <label className="field">
            <span>备注</span>
            <textarea
              className="textarea"
              rows={2}
              value={wf.notes}
              onChange={(e) => setWf((s) => ({ ...s, notes: e.target.value }))}
            />
          </label>
        </div>
      )}
      {tab === "select" && (
        <div className="stack" style={{ gap: 8 }}>
          <strong style={{ fontSize: 13 }}>选书四指标</strong>
          {(
            [
              ["dataOk", "数据门槛"],
              ["genreOk", "题材适合"],
              ["structureFriendly", "结构友好"],
              ["characterOk", "人物可立"],
              ["finishRateOk", "完读率尚可"],
              ["copyrightConfirmed", "版权已确认"],
              ["platformAcceptsAdapt", "对方收改编"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={wf.select[k]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    select: { ...s.select, [k]: e.target.checked },
                  }))
                }
              />
              <span style={{ fontSize: 12 }}>{l}</span>
            </label>
          ))}
          <strong style={{ fontSize: 13 }}>结构友好细项</strong>
          {(
            [
              ["burstEvery5to10", "5–10章一爆点"],
              ["strongConflict", "强冲突"],
              ["actionHeavy", "动作多"],
              ["visualStrong", "画面强"],
              ["paceFast", "节奏快"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={wf.select.structureChecks[k]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    select: {
                      ...s.select,
                      structureChecks: {
                        ...s.select.structureChecks,
                        [k]: e.target.checked,
                      },
                    },
                  }))
                }
              />
              <span style={{ fontSize: 12 }}>{l}</span>
            </label>
          ))}
          <div className="field-grid">
            {(
              [
                ["readsApprox", "在读约"],
                ["commentsApprox", "评论约"],
                ["ratingApprox", "评分"],
              ] as const
            ).map(([k, l]) => (
              <label key={k} className="field">
                <span>{l}</span>
                <input
                  className="input"
                  type="number"
                  value={wf.select[k]}
                  onChange={(e) =>
                    setWf((s) => ({
                      ...s,
                      select: { ...s.select, [k]: Number(e.target.value) || 0 },
                    }))
                  }
                />
              </label>
            ))}
          </div>
          <strong style={{ fontSize: 13 }}>不适改编勾选</strong>
          {IP_UNSUITABLE_TYPES.map((t) => (
            <label key={t} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={wf.select.unsuitableHits.includes(t)}
                onChange={(e) =>
                  setWf((s) => {
                    const hits = e.target.checked
                      ? [...s.select.unsuitableHits, t]
                      : s.select.unsuitableHits.filter((x) => x !== t);
                    return { ...s, select: { ...s.select, unsuitableHits: hits } };
                  })
                }
              />
              <span style={{ fontSize: 12 }}>{t}</span>
            </label>
          ))}
          <strong style={{ fontSize: 13 }}>锚定表 · 不能动</strong>
          {(
            [
              ["mainGoal", "主线目标"],
              ["corePersona", "核心人设"],
              ["goldFinger", "金手指"],
              ["worldRules", "世界规则"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="field">
              <span>{l}</span>
              <input
                className="input"
                value={wf.anchor[k]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    anchor: { ...s.anchor, [k]: e.target.value },
                  }))
                }
              />
            </label>
          ))}
          <strong style={{ fontSize: 13 }}>可动策略</strong>
          {(
            [
              ["canCutSide", "可砍支线"],
              ["canMergeSupport", "可合并配角"],
              ["canReorder", "可调叙事顺序"],
              ["canFrontloadCool", "可前置爽点"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={wf.anchor[k]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    anchor: { ...s.anchor, [k]: e.target.checked },
                  }))
                }
              />
              <span style={{ fontSize: 12 }}>{l}</span>
            </label>
          ))}
        </div>
      )}
      {tab === "logline" && (
        <div className="stack" style={{ gap: 8 }}>
          <p className="muted" style={{ fontSize: 11, margin: 0 }}>
            梗概四要素 + 导语五要素（含力量悬殊）；可与 SynopsisPanel 双向同步
          </p>
          {(
            [
              ["identity", "身份"],
              ["coreConflict", "核心冲突"],
              ["turnChance", "转折契机"],
              ["goldFinger", "金手指"],
              ["openConflict", "开篇冲突"],
              ["dilemma", "困境"],
              ["coreContradict", "核心矛盾"],
              ["turnHook", "转折契机(导语)"],
              ["powerGap", "力量悬殊"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="field">
              <span>{l}</span>
              <input
                className="input"
                value={wf.logline[k]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    logline: { ...s.logline, [k]: e.target.value },
                  }))
                }
              />
            </label>
          ))}
        </div>
      )}
      {tab === "units" && (
        <div className="stack" style={{ gap: 8 }}>
          <p className="muted" style={{ fontSize: 11, margin: 0 }}>
            批量建议 {wf.budget.batchFrom}–{wf.budget.batchTo} 章；3–6 章/单元；开篇情绪宜 ≤-6
          </p>
          <label className="field">
            <span>粘贴 ip.unit_cut / emotion YAML</span>
            <textarea
              className="textarea"
              rows={3}
              value={yamlPaste}
              onChange={(e) => setYamlPaste(e.target.value)}
              placeholder={"- id: u1\n  chapter_from: 1\n  chapter_to: 4\n  conflict: ...\n  emotion: -8"}
            />
          </label>
          <div className="row" style={{ gap: 6 }}>
            <Button size="sm" onClick={importYaml}>
              导入单元
            </Button>
            <Button
              size="sm"
              onClick={() =>
                setWf((s) => ({
                  ...s,
                  units: [
                    ...s.units,
                    {
                      id: `u${Date.now()}`,
                      chapterFrom: wf.budget.batchFrom || 1,
                      chapterTo: Math.min(
                        (wf.budget.batchFrom || 1) + 3,
                        wf.budget.batchTo || 4,
                      ),
                      conflict: "",
                      emotionScore: -6,
                      emotionTrail: [-8, -5, 0],
                      tight: true,
                      keep: true,
                    },
                  ],
                }))
              }
            >
              加单元
            </Button>
          </div>
          {wf.units.map((u, idx) => {
            const trail = unitEmotionTrail(u);
            const trailGate = validateUnitEmotionTrail(u);
            return (
              <div
                key={u.id}
                className="stack"
                style={{ gap: 4, borderTop: "1px solid var(--border)" }}
              >
                <div className="field-grid">
                  <label className="field">
                    <span>章起</span>
                    <input
                      className="input"
                      type="number"
                      value={u.chapterFrom}
                      onChange={(e) =>
                        setWf((s) => {
                          const units = [...s.units];
                          units[idx] = {
                            ...units[idx]!,
                            chapterFrom: Number(e.target.value) || 1,
                          };
                          return { ...s, units };
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>章止</span>
                    <input
                      className="input"
                      type="number"
                      value={u.chapterTo}
                      onChange={(e) =>
                        setWf((s) => {
                          const units = [...s.units];
                          units[idx] = {
                            ...units[idx]!,
                            chapterTo: Number(e.target.value) || 1,
                          };
                          return { ...s, units };
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>情绪分</span>
                    <input
                      className="input"
                      type="number"
                      min={-10}
                      max={10}
                      value={u.emotionScore}
                      onChange={(e) =>
                        setWf((s) => {
                          const units = [...s.units];
                          const score = Number(e.target.value) || 0;
                          units[idx] = {
                            ...units[idx]!,
                            emotionScore: score,
                            emotionTrail:
                              units[idx]!.emotionTrail.length < 2
                                ? [score]
                                : units[idx]!.emotionTrail,
                          };
                          return { ...s, units };
                        })
                      }
                    />
                  </label>
                </div>
                <label className="field">
                  <span>情绪轨迹（逗号分隔，2–5 点）</span>
                  <input
                    className="input"
                    value={(u.emotionTrail.length ? u.emotionTrail : trail).join(",")}
                    onChange={(e) =>
                      setWf((s) => {
                        const units = [...s.units];
                        const emotionTrail = e.target.value
                          .split(/[,，\s]+/)
                          .map(Number)
                          .filter((n) => Number.isFinite(n))
                          .slice(0, 5);
                        units[idx] = {
                          ...units[idx]!,
                          emotionTrail,
                          emotionScore: emotionTrail[0] ?? units[idx]!.emotionScore,
                        };
                        return { ...s, units };
                      })
                    }
                  />
                </label>
                <p className="muted" style={{ fontSize: 11, margin: 0 }}>
                  折线：{trail.join(" → ")} · {trailGate.message}
                </p>
                <label className="field">
                  <span>冲突</span>
                  <input
                    className="input"
                    value={u.conflict}
                    onChange={(e) =>
                      setWf((s) => {
                        const units = [...s.units];
                        units[idx] = { ...units[idx]!, conflict: e.target.value };
                        return { ...s, units };
                      })
                    }
                  />
                </label>
                <div className="row" style={{ gap: 12 }}>
                  <label className="row" style={{ gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={u.tight}
                      onChange={(e) =>
                        setWf((s) => {
                          const units = [...s.units];
                          units[idx] = { ...units[idx]!, tight: e.target.checked };
                          return { ...s, units };
                        })
                      }
                    />
                    <span style={{ fontSize: 12 }}>紧</span>
                  </label>
                  <label className="row" style={{ gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={u.keep}
                      onChange={(e) =>
                        setWf((s) => {
                          const units = [...s.units];
                          units[idx] = { ...units[idx]!, keep: e.target.checked };
                          return { ...s, units };
                        })
                      }
                    />
                    <span style={{ fontSize: 12 }}>keep</span>
                  </label>
                  <Button
                    size="sm"
                    onClick={() =>
                      setWf((s) => ({
                        ...s,
                        units: s.units.filter((_, i) => i !== idx),
                      }))
                    }
                  >
                    删
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {tab === "rebuild" && (
        <div className="stack" style={{ gap: 8 }}>
          <strong style={{ fontSize: 13 }}>压缩策略</strong>
          {(
            [
              ["mergeConflict", "冲突合并"],
              ["timeSkip", "时间跳"],
              ["coolFront", "爽点前置"],
              ["cutPsychology", "删心理过渡"],
              ["mergeChars", "人物合并"],
              ["ironTriangle", "铁三角"],
              ["cutEnv", "删环境描写"],
              ["cutRepeat", "删重复"],
              ["keepImportantSide", "保留重要支线"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={wf.rebuild[k]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    rebuild: { ...s.rebuild, [k]: e.target.checked },
                  }))
                }
              />
              <span style={{ fontSize: 12 }}>{l}</span>
            </label>
          ))}
          {(
            [
              ["epOpen", "开场冲突"],
              ["epCarry", "承接"],
              ["epSlap", "打脸"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="field">
              <span>分集地图 · {l}</span>
              <input
                className="input"
                value={wf.rebuild[k]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    rebuild: { ...s.rebuild, [k]: e.target.value },
                  }))
                }
              />
            </label>
          ))}
          <strong style={{ fontSize: 13 }}>单集节奏 / 付费卡点</strong>
          <label className="field">
            <span>分钟/集（1–3）</span>
            <input
              className="input"
              type="number"
              min={1}
              max={3}
              value={wf.rhythm.minutesPerEp}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  rhythm: {
                    ...s.rhythm,
                    minutesPerEp: Math.min(3, Math.max(1, Number(e.target.value) || 2)),
                  },
                }))
              }
            />
          </label>
          <label className="field">
            <span>前 5 秒做什么</span>
            <input
              className="input"
              value={wf.rhythm.first5sAction}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  rhythm: { ...s.rhythm, first5sAction: e.target.value },
                }))
              }
            />
          </label>
          {(
            [
              ["conflictIn3s", "前三秒冲突"],
              ["pushEvery30s", "每30秒推进"],
              ["sameBeatMax30s", "同情绪/信息≤30秒"],
              ["paywallEp10", "付费大卡点·10集"],
              ["paywallEp20", "付费大卡点·20集"],
              ["cutAtEmotionLow", "断章在情绪最低"],
              ["cutBeforeTwist", "断章在即将反转"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={wf.rhythm[k]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    rhythm: { ...s.rhythm, [k]: e.target.checked },
                  }))
                }
              />
              <span style={{ fontSize: 12 }}>{l}</span>
            </label>
          ))}
          <p className="muted" style={{ fontSize: 11 }}>
            {wf.rhythm.note}
          </p>
        </div>
      )}
      {tab === "av" && (
        <div className="stack" style={{ gap: 8 }}>
          <strong style={{ fontSize: 13 }}>视听验证</strong>
          {(
            [
              ["policyOk", "政策合规"],
              ["performanceOk", "表演难度可控"],
              ["aiGeneratable", "AI 可生成"],
              ["costSceneOk", "成本场景可接受"],
              ["platformPrefOk", "平台偏好匹配"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={wf.av[k]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    av: { ...s.av, [k]: e.target.checked },
                  }))
                }
              />
              <span style={{ fontSize: 12 }}>{l}</span>
            </label>
          ))}
          <strong style={{ fontSize: 13 }}>AdaptPitchPack 闸（派生）</strong>
          <Badge tone={packGate.ok ? "ok" : "warn"}>{packGate.message}</Badge>
          <p className="muted" style={{ fontSize: 11, margin: 0 }}>
            单元 {packSynced.unitCount} · 情绪点 {packSynced.emotionPoints} · 锚定{" "}
            {packSynced.anchorDone ? "齐" : "缺"}
          </p>
          <label className="field">
            <span>压缩剧本份数（artifacts 缺口可手补）</span>
            <input
              className="input"
              type="number"
              min={0}
              value={wf.pitchPack.scriptCount}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  pitchPack: {
                    ...s.pitchPack,
                    scriptCount: Math.max(0, Number(e.target.value) || 0),
                  },
                }))
              }
            />
          </label>
        </div>
      )}
    </Panel>
  );
}
