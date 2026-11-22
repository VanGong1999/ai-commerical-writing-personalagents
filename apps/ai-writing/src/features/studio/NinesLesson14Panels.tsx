/**
 * 九格 14.md 女频长篇深度：选题/六雷区/人设练习/主副线/留存/八报告。
 * 嵌入卷章节奏 FemaleLongPace（原 FormatWorkspaces FemaleLongWorkbench）；≠ 漫剧 12 步。
 */
import {
  ARCH_SIX_HAZARD_LABELS,
  EIGHT_PREWRITE_LABELS,
  FEMALE_HERO_CRAFT,
  FEMALE_HEROINE_CRAFT,
  FEMALE_LONG_DEPTH_CHECKPOINTS,
  FEMALE_MID_NODE_LABELS,
  FEMALE_SUBTRACK_HINTS,
  FemaleFourSwapThreeSchema,
  FemaleLongDepthWorkflowSchema,
  FemalePaceDepthSchema,
  femaleLongDepthWorkflowCompleteness,
  summarizeFemaleLongDepthToMaster,
  summarizeFemalePaceDepthToMaster,
  validateArchPractice,
  validateCharPractice,
  validateEightReports,
  validateFemaleFourSwapThree,
  validateRetentionTargets,
  validateTopicSixHazards,
  type ArchSixHazards,
  type FemaleLongDepthWorkflow,
  type MasterOutlineBody,
} from "@xiezuomanju/domain";
import { Badge, Button, Panel, Tabs } from "@xiezuomanju/ui";
import { Select } from "@xiezuomanju/ui";
import { useEffect, useMemo, useState } from "react";
import { CharacterDepthWorkbench } from "./NinesLesson10Panels";
import { FemalePaceDepthPanel } from "./NinesLesson15PacePanel";
import { runAgentFeedback } from "./runAgentFeedback";
import { usePersistedState } from "./usePersistedState";

export function emptyFemaleLongDepth(): FemaleLongDepthWorkflow {
  return {
    schemaVersion: "nines-14.md/1",
    currentStep: 0,
    industrySelf: "",
    industryChecks: {
      boutiqueTrend: false,
      auditTighten: false,
      conflictCoolDown: false,
      aiManjuTrend: false,
    },
    track: {
      subTrack: "",
      marketHot: "",
      strength: "",
      differentiation: "",
      dreamHook: "",
      healHook: "",
      mixElements: false,
      charDiff: false,
      plotDiff: false,
      dualPov: false,
    },
    topicHazards: {
      noCold: false,
      noHomogen: false,
      noTooBig: false,
      noTooSmall: false,
      capabilityMatch: false,
      noHardHotword: false,
    },
    chars: {
      heroineCraft: [],
      heroCraft: [],
      cards: [],
      minBioChars: 300,
    },
    charHazards: {
      noCollapse: false,
      noHeroTool: false,
      noSaint: false,
      noHomogen: false,
      noFloating: false,
      gold500Hint: "黄金500字开篇：背景+冲突+目标+特质",
    },
    arch: {
      mainline: "",
      stageGoals: [],
      subPlots: [],
      nodeCh1: "",
      nodeCh10: "",
      nodeCh50: "",
      nodeCh100: "",
      nodeMid: [],
      archOutline: "",
      minOutlineChars: 800,
    },
    archHazards: {
      mainFocused: false,
      subClosed: false,
      emotionDriven: false,
      logicSupport: false,
      noBranchFlood: false,
      nodePlanned: false,
    },
    retention: {
      ch1: 70,
      ch10: 55,
      ch50: 40,
      ch100: 35,
      targetsLocked: false,
    },
    eightReports: {
      items: EIGHT_PREWRITE_LABELS.map((label, i) => ({
        id: `er${i + 1}`,
        label,
        done: false,
        note: "",
        linkedKey: "",
      })),
    },
    adaptPotential: "",
    fourSwapThree: FemaleFourSwapThreeSchema.parse({}),
    paceDepth: FemalePaceDepthSchema.parse({}),
    notes: "",
  };
}

const HEROINE_CRAFT = [...FEMALE_HEROINE_CRAFT];
const HERO_CRAFT = [...FEMALE_HERO_CRAFT];
const SUBTRACKS = Object.keys(FEMALE_SUBTRACK_HINTS);

export function FemaleLongDepthWorkbench({ projectId }: { projectId?: string }) {
  const [wf, setWf] = usePersistedState(
    projectId,
    "female-long-depth-wf",
    emptyFemaleLongDepth(),
  );
  useEffect(() => {
    setWf((s) => FemaleLongDepthWorkflowSchema.parse(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  const score = useMemo(() => femaleLongDepthWorkflowCompleteness(wf), [wf]);
  const [tab, setTab] = usePersistedState(projectId, "fl-l14-tab", "overview");
  const topic6 = validateTopicSixHazards(wf.topicHazards);
  const charP = validateCharPractice(wf.chars);
  const archP = validateArchPractice(wf.arch);
  const ret = validateRetentionTargets(wf.retention);
  const eight = validateEightReports(wf.eightReports);
  const fourSwap = validateFemaleFourSwapThree(wf.fourSwapThree);

  const syncThin = () => {
    if (!projectId) return;
    try {
      const thin = {
        ...summarizeFemaleLongDepthToMaster(wf),
        ...summarizeFemalePaceDepthToMaster(wf.paceDepth),
      };
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
      title="女频长篇深度（14.md）"
      actions={
        <div className="row" style={{ gap: 6 }}>
          <Badge>
            {score.filledSteps}/{score.totalSteps}
          </Badge>
          <Button size="sm" onClick={syncThin}>
            回写摘要
          </Button>
        </div>
      }
    >
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        选题/人设/架构/八报告；下方嵌入卷章节奏台。≠ 漫剧 12 步，≠ L10 短篇手搓主链。
      </p>
      {score.missing.length > 0 && (
        <Badge tone="warn">未完成：{score.missing.join("、")}</Badge>
      )}
      <div className="row" style={{ flexWrap: "wrap", gap: 6, margin: "8px 0" }}>
        {FEMALE_LONG_DEPTH_CHECKPOINTS.map((cp, i) => (
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
          { id: "topic", label: "选题/六雷" },
          { id: "chars", label: "人设练习" },
          { id: "arch", label: "架构/留存" },
          { id: "eight", label: "八报告" },
          { id: "fourswap", label: "四换三" },
          { id: "l15", label: "15节奏下半" },
          { id: "pace", label: "节奏嵌入" },
        ]}
      />
      {tab === "overview" && (
        <div className="stack" style={{ gap: 6 }}>
          <Badge tone={topic6.ok ? "ok" : "warn"}>{topic6.message}</Badge>
          <Badge tone={charP.ok ? "ok" : "warn"}>{charP.message}</Badge>
          <Badge tone={archP.ok ? "ok" : "warn"}>{archP.message}</Badge>
          <Badge tone={ret.ok ? "ok" : "warn"}>{ret.message}</Badge>
          <Badge tone={eight.ok ? "ok" : "warn"}>{eight.message}</Badge>
          <Badge tone={fourSwap.ok ? "ok" : "warn"}>{fourSwap.message}</Badge>
          <strong style={{ fontSize: 13 }}>行业趋势勾选</strong>
          {(
            [
              ["boutiqueTrend", "精品化"],
              ["auditTighten", "审核收紧"],
              ["conflictCoolDown", "强冲突降温"],
              ["aiManjuTrend", "AI 漫剧趋势"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={wf.industryChecks[k]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    industryChecks: { ...s.industryChecks, [k]: e.target.checked },
                  }))
                }
              />
              <span style={{ fontSize: 12 }}>{l}</span>
            </label>
          ))}
          <label className="field">
            <span>行业自评（长文）</span>
            <textarea
              className="textarea"
              rows={2}
              value={wf.industrySelf}
              placeholder="市场观察 + 能力清单"
              onChange={(e) => setWf((s) => ({ ...s, industrySelf: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>改编潜力（画面感软闸）</span>
            <input
              className="input"
              value={wf.adaptPotential}
              onChange={(e) => setWf((s) => ({ ...s, adaptPotential: e.target.value }))}
            />
          </label>
        </div>
      )}
      {tab === "topic" && (
        <div className="stack" style={{ gap: 8 }}>
          <strong style={{ fontSize: 13 }}>赛道</strong>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {(
              [
                ["core", "核心"],
                ["potential", "潜力"],
                ["cold", "冷门"],
              ] as const
            ).map(([id, l]) => (
              <button
                key={id}
                type="button"
                className="btn btn-sm"
                style={{
                  outline: wf.track.tier === id ? "2px solid var(--accent)" : undefined,
                }}
                onClick={() =>
                  setWf((s) => ({ ...s, track: { ...s.track, tier: id } }))
                }
              >
                {l}
              </button>
            ))}
          </div>
          <label className="field">
            <span>子赛道</span>
            <Select
              className="select"
              value={wf.track.subTrack}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  track: { ...s.track, subTrack: e.target.value },
                }))
              }
            >
              <option value="">选择</option>
              {SUBTRACKS.map((t) => (
                <option key={t} value={t}>
                  {t}（{FEMALE_SUBTRACK_HINTS[t]}）
                </option>
              ))}
            </Select>
          </label>
          {wf.track.subTrack ? (
            <p className="muted" style={{ fontSize: 11, margin: 0 }}>
              {FEMALE_SUBTRACK_HINTS[wf.track.subTrack] ?? ""}
            </p>
          ) : null}
          {(
            [
              ["marketHot", "市场热度"],
              ["strength", "个人擅长"],
              ["differentiation", "差异化"],
              ["dreamHook", "15–25 梦（共鸣）"],
              ["healHook", "35–50 补（疗愈）"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="field">
              <span>{l}</span>
              <input
                className="input"
                value={wf.track[k]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    track: { ...s.track, [k]: e.target.value },
                  }))
                }
              />
            </label>
          ))}
          <strong style={{ fontSize: 13 }}>四差异化技巧</strong>
          {(
            [
              ["mixElements", "元素混搭"],
              ["charDiff", "人设差异"],
              ["plotDiff", "情节差异"],
              ["dualPov", "双视角"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={wf.track[k]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    track: { ...s.track, [k]: e.target.checked },
                  }))
                }
              />
              <span style={{ fontSize: 12 }}>{l}</span>
            </label>
          ))}
          <strong style={{ fontSize: 13 }}>选题六雷区</strong>
          {(
            [
              ["noCold", "避开冷门到写不动"],
              ["noHomogen", "避开同质化"],
              ["noTooBig", "避开题材太大"],
              ["noTooSmall", "避开题材太小"],
              ["capabilityMatch", "能力匹配"],
              ["noHardHotword", "不硬蹭热词"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={wf.topicHazards[k]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    topicHazards: { ...s.topicHazards, [k]: e.target.checked },
                  }))
                }
              />
              <span style={{ fontSize: 12 }}>{l}</span>
            </label>
          ))}
        </div>
      )}
      {tab === "chars" && (
        <div className="stack" style={{ gap: 8 }}>
          <p className="muted" style={{ fontSize: 11, margin: 0 }}>
            练习1：女主/男主四技巧齐 + 每角色≥{wf.chars.minBioChars}字；须含女主/男主/正配/反配
          </p>
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            <Button
              size="sm"
              disabled={!projectId}
              onClick={() =>
                projectId &&
                void runAgentFeedback(projectId, "char.bible_big5", {
                  label: "char.bible_big5",
                  inputJson: {
                    cards: wf.chars.cards.map((c) => ({
                      role: c.role,
                      name: c.name,
                      bio: c.bio.slice(0, 200),
                    })),
                  },
                })
              }
            >
              Big5 人设 Agent
            </Button>
            <Badge>链 L10 CharacterDepth</Badge>
          </div>
          <CharacterDepthWorkbench projectId={projectId} />
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {HEROINE_CRAFT.map((c) => (
              <label key={c} className="row" style={{ gap: 4 }}>
                <input
                  type="checkbox"
                  checked={wf.chars.heroineCraft.includes(c)}
                  onChange={(e) =>
                    setWf((s) => ({
                      ...s,
                      chars: {
                        ...s.chars,
                        heroineCraft: e.target.checked
                          ? [...s.chars.heroineCraft, c]
                          : s.chars.heroineCraft.filter((x) => x !== c),
                      },
                    }))
                  }
                />
                <span style={{ fontSize: 11 }}>女主·{c}</span>
              </label>
            ))}
          </div>
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {HERO_CRAFT.map((c) => (
              <label key={c} className="row" style={{ gap: 4 }}>
                <input
                  type="checkbox"
                  checked={wf.chars.heroCraft.includes(c)}
                  onChange={(e) =>
                    setWf((s) => ({
                      ...s,
                      chars: {
                        ...s.chars,
                        heroCraft: e.target.checked
                          ? [...s.chars.heroCraft, c]
                          : s.chars.heroCraft.filter((x) => x !== c),
                      },
                    }))
                  }
                />
                <span style={{ fontSize: 11 }}>男主·{c}</span>
              </label>
            ))}
          </div>
          <Button
            size="sm"
            onClick={() =>
              setWf((s) => ({
                ...s,
                chars: {
                  ...s.chars,
                  cards: [
                    ...s.chars.cards,
                    {
                      id: `c${Date.now()}`,
                      role: "heroine",
                      name: "",
                      craftNote: "",
                      bio: "",
                    },
                  ],
                },
              }))
            }
          >
            加人设卡
          </Button>
          {wf.chars.cards.map((card, idx) => (
            <div key={card.id} className="stack" style={{ gap: 4, borderTop: "1px solid var(--border)" }}>
              <div className="field-grid">
                <label className="field">
                  <span>角色</span>
                  <Select
                    className="select"
                    value={card.role}
                    onChange={(e) =>
                      setWf((s) => {
                        const cards = [...s.chars.cards];
                        cards[idx] = {
                          ...cards[idx]!,
                          role: e.target.value as typeof card.role,
                        };
                        return { ...s, chars: { ...s.chars, cards } };
                      })
                    }
                  >
                    <option value="heroine">女主</option>
                    <option value="hero">男主</option>
                    <option value="support_pos">正配</option>
                    <option value="support_neg">反配</option>
                  </Select>
                </label>
                <label className="field">
                  <span>姓名</span>
                  <input
                    className="input"
                    value={card.name}
                    onChange={(e) =>
                      setWf((s) => {
                        const cards = [...s.chars.cards];
                        cards[idx] = { ...cards[idx]!, name: e.target.value };
                        return { ...s, chars: { ...s.chars, cards } };
                      })
                    }
                  />
                </label>
              </div>
              <label className="field">
                <span>技巧备注</span>
                <input
                  className="input"
                  value={card.craftNote}
                  onChange={(e) =>
                    setWf((s) => {
                      const cards = [...s.chars.cards];
                      cards[idx] = { ...cards[idx]!, craftNote: e.target.value };
                      return { ...s, chars: { ...s.chars, cards } };
                    })
                  }
                />
              </label>
              <label className="field">
                <span>
                  小传（{card.bio.trim().length}/{wf.chars.minBioChars}）
                </span>
                <textarea
                  className="textarea"
                  rows={4}
                  value={card.bio}
                  onChange={(e) =>
                    setWf((s) => {
                      const cards = [...s.chars.cards];
                      cards[idx] = { ...cards[idx]!, bio: e.target.value };
                      return { ...s, chars: { ...s.chars, cards } };
                    })
                  }
                />
              </label>
              <Button
                size="sm"
                onClick={() =>
                  setWf((s) => ({
                    ...s,
                    chars: {
                      ...s.chars,
                      cards: s.chars.cards.filter((_, i) => i !== idx),
                    },
                  }))
                }
              >
                删卡
              </Button>
            </div>
          ))}
          <strong style={{ fontSize: 13 }}>人设五雷区</strong>
          <p className="muted" style={{ fontSize: 11 }}>
            {wf.charHazards.gold500Hint}
          </p>
          {(
            [
              ["noCollapse", "不崩塌"],
              ["noHeroTool", "男主非工具人"],
              ["noSaint", "非圣母"],
              ["noHomogen", "不同质化"],
              ["noFloating", "不悬浮"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={wf.charHazards[k]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    charHazards: { ...s.charHazards, [k]: e.target.checked },
                  }))
                }
              />
              <span style={{ fontSize: 12 }}>{l}</span>
            </label>
          ))}
        </div>
      )}
      {tab === "arch" && (
        <div className="stack" style={{ gap: 8 }}>
          <label className="field">
            <span>主线</span>
            <input
              className="input"
              value={wf.arch.mainline}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  arch: { ...s.arch, mainline: e.target.value },
                }))
              }
            />
          </label>
          <label className="field">
            <span>阶段性目标（逗号分隔）</span>
            <input
              className="input"
              value={wf.arch.stageGoals.join("，")}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  arch: {
                    ...s.arch,
                    stageGoals: e.target.value
                      .split(/[,，]/)
                      .map((x) => x.trim())
                      .filter(Boolean),
                  },
                }))
              }
            />
          </label>
          <Button
            size="sm"
            onClick={() =>
              setWf((s) => ({
                ...s,
                arch: {
                  ...s.arch,
                  subPlots: [
                    ...s.arch.subPlots,
                    {
                      id: `s${Date.now()}`,
                      label: "",
                      volumeShare: 0.15,
                      closedLoop: false,
                    },
                  ].slice(0, 3),
                },
              }))
            }
          >
            加副线（2–3；合计≤1/3）
          </Button>
          {wf.arch.subPlots.map((sp, idx) => (
            <div key={sp.id} className="field-grid">
              <label className="field">
                <span>副线</span>
                <input
                  className="input"
                  value={sp.label}
                  onChange={(e) =>
                    setWf((s) => {
                      const subPlots = [...s.arch.subPlots];
                      subPlots[idx] = { ...subPlots[idx]!, label: e.target.value };
                      return { ...s, arch: { ...s.arch, subPlots } };
                    })
                  }
                />
              </label>
              <label className="field">
                <span>体量占比</span>
                <input
                  className="input"
                  type="number"
                  step={0.05}
                  min={0}
                  max={1}
                  value={sp.volumeShare}
                  onChange={(e) =>
                    setWf((s) => {
                      const subPlots = [...s.arch.subPlots];
                      subPlots[idx] = {
                        ...subPlots[idx]!,
                        volumeShare: Number(e.target.value) || 0,
                      };
                      return { ...s, arch: { ...s.arch, subPlots } };
                    })
                  }
                />
              </label>
              <label className="row" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={sp.closedLoop}
                  onChange={(e) =>
                    setWf((s) => {
                      const subPlots = [...s.arch.subPlots];
                      subPlots[idx] = {
                        ...subPlots[idx]!,
                        closedLoop: e.target.checked,
                      };
                      return { ...s, arch: { ...s.arch, subPlots } };
                    })
                  }
                />
                <span style={{ fontSize: 12 }}>闭环</span>
              </label>
            </div>
          ))}
          {(
            [
              ["nodeCh1", "Ch1 节点"],
              ["nodeCh10", "Ch10 节点"],
              ["nodeCh50", "Ch50 节点"],
              ["nodeCh100", "Ch100 节点"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="field">
              <span>{l}</span>
              <input
                className="input"
                value={wf.arch[k]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    arch: { ...s.arch, [k]: e.target.value },
                  }))
                }
              />
            </label>
          ))}
          <strong style={{ fontSize: 13 }}>中期节点勾选（可选）</strong>
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {FEMALE_MID_NODE_LABELS.map((lab) => (
              <label key={lab} className="row" style={{ gap: 4 }}>
                <input
                  type="checkbox"
                  checked={wf.arch.nodeMid.includes(lab)}
                  onChange={(e) =>
                    setWf((s) => ({
                      ...s,
                      arch: {
                        ...s.arch,
                        nodeMid: e.target.checked
                          ? [...s.arch.nodeMid, lab]
                          : s.arch.nodeMid.filter((x) => x !== lab),
                      },
                    }))
                  }
                />
                <span style={{ fontSize: 11 }}>{lab}</span>
              </label>
            ))}
          </div>
          <label className="field">
            <span>
              架构大纲（练习2 · {wf.arch.archOutline.trim().length}/
              {wf.arch.minOutlineChars}）
            </span>
            <textarea
              className="textarea"
              rows={6}
              value={wf.arch.archOutline}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  arch: { ...s.arch, archOutline: e.target.value },
                }))
              }
            />
          </label>
          <strong style={{ fontSize: 13 }}>架构六雷区（讲义 §5.7）</strong>
          {(Object.keys(ARCH_SIX_HAZARD_LABELS) as (keyof ArchSixHazards)[]).map((k) => (
            <label key={k} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={wf.archHazards[k]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    archHazards: { ...s.archHazards, [k]: e.target.checked },
                  }))
                }
              />
              <span style={{ fontSize: 12 }}>{ARCH_SIX_HAZARD_LABELS[k]}</span>
            </label>
          ))}
          <strong style={{ fontSize: 13 }}>留存仪表 70/55/40/35</strong>
          <div className="field-grid">
            {(
              [
                ["ch1", "Ch1%"],
                ["ch10", "Ch10%"],
                ["ch50", "Ch50%"],
                ["ch100", "Ch100%"],
              ] as const
            ).map(([k, l]) => (
              <label key={k} className="field">
                <span>{l}</span>
                <input
                  className="input"
                  type="number"
                  value={wf.retention[k]}
                  onChange={(e) =>
                    setWf((s) => ({
                      ...s,
                      retention: {
                        ...s.retention,
                        [k]: Number(e.target.value) || 0,
                      },
                    }))
                  }
                />
              </label>
            ))}
          </div>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={wf.retention.targetsLocked}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  retention: { ...s.retention, targetsLocked: e.target.checked },
                }))
              }
            />
            <span style={{ fontSize: 12 }}>留存目标已锁定</span>
          </label>
        </div>
      )}
      {tab === "eight" && (
        <div className="stack" style={{ gap: 8 }}>
          <p className="muted" style={{ fontSize: 11, margin: 0 }}>
            8 勾齐 + 至少 4 项备注≥20 字。情绪→Emotion；伏笔→foreshadow；架构/总纲→回写摘要。
          </p>
          {wf.eightReports.items.map((item, idx) => (
            <div key={item.id} className="stack" style={{ gap: 4 }}>
              <label className="row" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={(e) =>
                    setWf((s) => {
                      const items = [...s.eightReports.items];
                      items[idx] = { ...items[idx]!, done: e.target.checked };
                      return { ...s, eightReports: { items } };
                    })
                  }
                />
                <span style={{ fontSize: 12 }}>{item.label}</span>
              </label>
              <textarea
                className="textarea"
                rows={2}
                placeholder="薄备注≥20字"
                value={item.note ?? ""}
                onChange={(e) =>
                  setWf((s) => {
                    const items = [...s.eightReports.items];
                    items[idx] = {
                      ...items[idx]!,
                      note: e.target.value,
                      linkedKey: items[idx]!.linkedKey ?? "",
                    };
                    return { ...s, eightReports: { items } };
                  })
                }
              />
              {item.label.includes("情绪") ? (
                <div className="row" style={{ gap: 6 }}>
                  <Button size="sm" onClick={() => setTab("l15")}>
                    展开15节奏台
                  </Button>
                  <Button
                    size="sm"
                    disabled={!projectId}
                    onClick={() => {
                      setWf((s) => {
                        const items = [...s.eightReports.items];
                        items[idx] = {
                          ...items[idx]!,
                          linkedKey: "paceCurve",
                          done: true,
                        };
                        return { ...s, eightReports: { items } };
                      });
                      setTab("l15");
                    }}
                  >
                    linkedKey:paceCurve
                  </Button>
                </div>
              ) : null}
              {item.label.includes("伏笔") ? (
                <Button
                  size="sm"
                  disabled={!projectId}
                  onClick={() =>
                    projectId &&
                    void runAgentFeedback(projectId, "hook.foreshadow_ledger", {
                      label: "hook.foreshadow_ledger",
                    })
                  }
                >
                  链伏笔台账
                </Button>
              ) : null}
              {(item.label.includes("总纲") || item.label.includes("架构")) && (
                <Button size="sm" onClick={syncThin}>
                  回写总纲摘要
                </Button>
              )}
            </div>
          ))}
          <Badge tone={eight.ok ? "ok" : "warn"}>{eight.message}</Badge>
        </div>
      )}
      {tab === "fourswap" && (
        <div className="stack" style={{ gap: 8 }}>
          <p className="muted" style={{ fontSize: 12 }}>
            狂更猫四换三：对标背景/人设/金手指/主线，换三保主线；链现有 swap，不另起换元。
          </p>
          <Badge tone={fourSwap.ok ? "ok" : "warn"}>{fourSwap.message}</Badge>
          <strong style={{ fontSize: 13 }}>对标四要素</strong>
          {(
            [
              ["baseBackground", "背景"],
              ["baseCharacter", "人设"],
              ["baseGoldFinger", "金手指"],
              ["baseMainline", "主线（保留本质）"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="field">
              <span>{l}</span>
              <textarea
                className="textarea"
                rows={2}
                value={wf.fourSwapThree[k]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    fourSwapThree: { ...s.fourSwapThree, [k]: e.target.value },
                  }))
                }
              />
            </label>
          ))}
          <strong style={{ fontSize: 13 }}>换三勾选</strong>
          {(
            [
              ["swapBackground", "换背景"],
              ["swapCharacter", "换人设"],
              ["swapGoldFinger", "换金手指"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={wf.fourSwapThree[k]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    fourSwapThree: { ...s.fourSwapThree, [k]: e.target.checked },
                  }))
                }
              />
              <span style={{ fontSize: 12 }}>{l}</span>
            </label>
          ))}
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={wf.fourSwapThree.mainlineLocked}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  fourSwapThree: {
                    ...s.fourSwapThree,
                    mainlineLocked: e.target.checked,
                  },
                }))
              }
            />
            <span style={{ fontSize: 12 }}>主线只读锁（推荐勾选）</span>
          </label>
          <strong style={{ fontSize: 13 }}>换后三要素</strong>
          {(
            [
              ["swappedBackground", "换后背景"],
              ["swappedCharacter", "换后人设"],
              ["swappedGoldFinger", "换后金手指"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="field">
              <span>{l}</span>
              <textarea
                className="textarea"
                rows={2}
                value={wf.fourSwapThree[k]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    fourSwapThree: { ...s.fourSwapThree, [k]: e.target.value },
                  }))
                }
              />
            </label>
          ))}
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <Button
              disabled={!projectId}
              onClick={() =>
                projectId &&
                void runAgentFeedback(projectId, "swap.master", {
                  label: "swap.master",
                  inputJson: {
                    mode: "female_four_swap_three",
                    four_swap_three: wf.fourSwapThree,
                    keep_mainline: wf.fourSwapThree.baseMainline,
                  },
                })
              }
            >
              链 swap.master
            </Button>
            <Button
              disabled={!projectId}
              onClick={() =>
                projectId &&
                void runAgentFeedback(projectId, "swap.plan", {
                  label: "swap.plan",
                  inputJson: {
                    mode: "female_four_swap_three",
                    four_swap_three: wf.fourSwapThree,
                  },
                })
              }
            >
              链 swap.plan
            </Button>
          </div>
        </div>
      )}
      {tab === "l15" && (
        <FemalePaceDepthPanel
          projectId={projectId}
          paceDepth={wf.paceDepth ?? FemalePaceDepthSchema.parse({})}
          setPaceDepth={(updater) =>
            setWf((s) => ({
              ...s,
              paceDepth: updater(s.paceDepth ?? FemalePaceDepthSchema.parse({})),
            }))
          }
        />
      )}
      {tab === "pace" && (
        <div className="stack" style={{ gap: 8 }}>
          <Badge>嵌入既有卷章节奏台（FemaleLongWorkbench）</Badge>
          <FemaleLongWorkbench
            projectId={projectId}
            paceContext={{
              mainline: wf.arch.mainline,
              retention: wf.retention,
              paceNodes: wf.paceDepth?.curve.nodes,
            }}
          />
        </div>
      )}
    </Panel>
  );
}

const CHASE_STEPS = [
  { id: "相爱", tip: "建立羁绊与化学反应" },
  { id: "误会", tip: "伤害要写足，后悔才成立" },
  { id: "分手", tip: "决裂要有代价" },
  { id: "追妻", tip: "男主行动弥补，女主有底线" },
  { id: "HE", tip: "和解兑现承诺，不廉价原谅" },
];

/** 原 FormatWorkspaces 女频节奏台；供 Depth 嵌入与 Format 挂载复用 */
export function FemaleLongWorkbench({
  projectId,
  artifacts: _artifacts,
  paceContext,
}: {
  projectId?: string;
  artifacts?: unknown[];
  paceContext?: {
    mainline?: string;
    retention?: { ch1: number; ch10: number; ch50: number; ch100: number };
    paceNodes?: Array<{ chapter: number; kind: string; note?: string }>;
  };
} = {}) {
  const [step, setStep] = useState(0);
  const storageKey = projectId ? `fmt:${projectId}:female` : null;
  const [form, setForm] = useState({
    formula: "夺权 + 复仇 + 爱情",
    milestones: "3–4 个里程碑",
    pace: "小爽 8–12 章；大爽 40–60 章；留存线 70%/55%/40%/35%",
  });
  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setForm((f) => ({ ...f, ...(JSON.parse(raw) as typeof f) }));
    } catch {
      /* ignore */
    }
  }, [storageKey]);
  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(form));
    } catch {
      /* ignore */
    }
  }, [storageKey, form]);

  return (
    <div className="stack">
      <Panel title="卷章架构 · 节奏">
        <div className="field-grid">
          <div className="field">
            <label>主线公式</label>
            <input
              className="input"
              value={form.formula}
              onChange={(e) => setForm((f) => ({ ...f, formula: e.target.value }))}
            />
          </div>
          <div className="field">
            <label>阶段性目标</label>
            <input
              className="input"
              value={form.milestones}
              onChange={(e) => setForm((f) => ({ ...f, milestones: e.target.value }))}
            />
          </div>
          <div className="field full">
            <label>节奏备忘</label>
            <textarea
              className="textarea"
              rows={4}
              value={form.pace}
              onChange={(e) => setForm((f) => ({ ...f, pace: e.target.value }))}
            />
          </div>
        </div>
        <div className="row" style={{ marginTop: 8, gap: 8 }}>
          <Button
            disabled={!projectId}
            onClick={() =>
              projectId &&
              void runAgentFeedback(projectId, "female.pace", {
                label: "female.pace",
                inputJson: {
                  formula: form.formula,
                  milestones: form.milestones,
                  mainline: paceContext?.mainline,
                  retention: paceContext?.retention,
                  nodes: paceContext?.paceNodes,
                },
              })
            }
          >
            节奏配比体检
          </Button>
          <Button
            disabled={!projectId}
            onClick={() =>
              projectId &&
              void runAgentFeedback(projectId, "female.tension", { label: "female.tension" })
            }
          >
            拉扯感训练
          </Button>
        </div>
      </Panel>
      <Panel title="追妻火葬场五部曲">
        <div className="row" style={{ flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {CHASE_STEPS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className="badge"
              data-active={i === step}
              style={i === step ? { borderColor: "var(--accent)" } : undefined}
              onClick={() => setStep(i)}
            >
              {i + 1}. {s.id}
            </button>
          ))}
        </div>
        <p className="muted">{CHASE_STEPS[step]?.tip}</p>
        <Button
          variant="primary"
          disabled={!projectId}
          onClick={() =>
            projectId &&
            void runAgentFeedback(projectId, "struct.chase_wife", {
              label: "struct.chase_wife",
              inputJson: { step: CHASE_STEPS[step]?.id, stepIndex: step },
            })
          }
        >
          生成本步节拍
        </Button>
      </Panel>
    </div>
  );
}
