/**
 * 15.md 女频节奏下半：嵌 FemaleLongDepth.paceDepth；复用 female.pace。
 */
import {
  FEMALE_EMOTION_KINDS,
  FEMALE_PACE_DEPTH_CHECKPOINTS,
  femalePaceDepthCompleteness,
  PACE_NODE_KINDS,
  summarizeFemalePaceDepthToMaster,
  validateDetailLab,
  validateEmotionLab,
  validateMonetizePlan,
  validatePaceOutline,
  validateRiskAvoidList,
  validateSerialMonitor,
  type FemalePaceDepth,
  type MasterOutlineBody,
} from "@xiezuomanju/domain";
import { Badge, Button, Panel } from "@xiezuomanju/ui";
import { Select } from "@xiezuomanju/ui";
import { useMemo } from "react";
import { runAgentFeedback } from "./runAgentFeedback";

export function FemalePaceDepthPanel({
  projectId,
  paceDepth,
  setPaceDepth,
}: {
  projectId?: string;
  paceDepth: FemalePaceDepth;
  setPaceDepth: (updater: (p: FemalePaceDepth) => FemalePaceDepth) => void;
}) {
  const score = useMemo(() => femalePaceDepthCompleteness(paceDepth), [paceDepth]);
  const curveG = validatePaceOutline(paceDepth.curve);
  const emoG = validateEmotionLab(paceDepth.emotionLab);
  const detG = validateDetailLab(paceDepth.detailLab);
  const riskG = validateRiskAvoidList(paceDepth.riskList);
  const monG = validateMonetizePlan(paceDepth.monetize);
  const serG = validateSerialMonitor(paceDepth.serial);

  const syncThin = () => {
    if (!projectId) return;
    try {
      const thin = summarizeFemalePaceDepthToMaster(paceDepth);
      const key = `deep:${projectId}:master-outline`;
      const prev = localStorage.getItem(key);
      const base = prev ? (JSON.parse(prev) as MasterOutlineBody) : {};
      localStorage.setItem(key, JSON.stringify({ ...base, ...thin }));
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <Badge>
          15节奏 {score.filledSteps}/{score.totalSteps}
        </Badge>
        <Badge tone={curveG.ok ? "ok" : "warn"}>{curveG.message}</Badge>
        <Badge tone={emoG.ok ? "ok" : "warn"}>{emoG.message}</Badge>
        <Badge tone={monG.ok ? "ok" : "warn"}>{monG.message}</Badge>
        <Button size="sm" onClick={syncThin}>
          回写15摘要
        </Button>
        <Button
          size="sm"
          disabled={!projectId}
          onClick={() =>
            projectId &&
            void runAgentFeedback(projectId, "female.pace", {
              label: "female.pace",
              inputJson: {
                nodes: paceDepth.curve.nodes,
                phases: paceDepth.curve.phases,
                genre_sub: paceDepth.curve.genreSub,
                total_words: paceDepth.curve.totalWordsPlan,
              },
            })
          }
        >
          节奏配比体检
        </Button>
      </div>
      {score.missing.length > 0 && (
        <Badge tone="warn">未完成：{score.missing.join("、")}</Badge>
      )}
      <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
        {FEMALE_PACE_DEPTH_CHECKPOINTS.map((cp, i) => (
          <span key={cp.id} className="badge" style={{ fontSize: 11 }}>
            {i + 1}.{cp.label.replace(/^\d+\./, "")}
          </span>
        ))}
      </div>

      <Panel title="节奏曲线报告">
        <label className="field">
          <span>目标总字数</span>
          <input
            className="input"
            type="number"
            value={paceDepth.curve.totalWordsPlan}
            onChange={(e) =>
              setPaceDepth((p) => ({
                ...p,
                curve: {
                  ...p.curve,
                  totalWordsPlan: Number(e.target.value) || 0,
                },
              }))
            }
          />
        </label>
        <div className="stack" style={{ gap: 4 }}>
          {paceDepth.curve.phases.map((ph, idx) => (
            <p key={ph.name} className="muted" style={{ fontSize: 12, margin: 0 }}>
              {ph.name === "early" ? "前" : ph.name === "mid" ? "中" : "后"}期{" "}
              {ph.chapterRange} · 小爽 {ph.smallCoolEvery} · 缓冲每{ph.bufferEvery}章 ·
              大爽@{ph.bigCoolAt.join("/") || "—"}
              <button
                type="button"
                className="btn btn-sm"
                style={{ marginLeft: 6 }}
                onClick={() =>
                  setPaceDepth((p) => {
                    const phases = [...p.curve.phases];
                    phases[idx] = {
                      ...phases[idx]!,
                      bufferEvery: phases[idx]!.bufferEvery,
                    };
                    return { ...p, curve: { ...p.curve, phases } };
                  })
                }
              >
                已设
              </button>
            </p>
          ))}
        </div>
        <Button
          size="sm"
          onClick={() =>
            setPaceDepth((p) => ({
              ...p,
              curve: {
                ...p.curve,
                nodes: [
                  ...p.curve.nodes,
                  {
                    id: `n${Date.now()}`,
                    chapter: 1,
                    kind: "small",
                    note: "",
                  },
                ],
              },
            }))
          }
        >
          加节点
        </Button>
        {paceDepth.curve.nodes.map((n, idx) => (
          <div key={n.id} className="field-grid">
            <label className="field">
              <span>章</span>
              <input
                className="input"
                type="number"
                value={n.chapter}
                onChange={(e) =>
                  setPaceDepth((p) => {
                    const nodes = [...p.curve.nodes];
                    nodes[idx] = {
                      ...nodes[idx]!,
                      chapter: Number(e.target.value) || 1,
                    };
                    return { ...p, curve: { ...p.curve, nodes } };
                  })
                }
              />
            </label>
            <label className="field">
              <span>类型</span>
              <Select
                className="select"
                value={n.kind}
                onChange={(e) =>
                  setPaceDepth((p) => {
                    const nodes = [...p.curve.nodes];
                    nodes[idx] = {
                      ...nodes[idx]!,
                      kind: e.target.value as (typeof PACE_NODE_KINDS)[number],
                    };
                    return { ...p, curve: { ...p.curve, nodes } };
                  })
                }
              >
                {PACE_NODE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </Select>
            </label>
          </div>
        ))}
        <strong style={{ fontSize: 12 }}>六节奏雷区</strong>
        {(
          [
            ["noVacuum15", ">15章无爽真空"],
            ["noStackCool", "连爽有缓冲"],
            ["noMidSoft", "中段不疲软"],
            ["noRushEnd", "不仓促收"],
            ["noSlowOpen", "开局不慢"],
            ["genreMatch", "题材配比匹配"],
          ] as const
        ).map(([k, l]) => (
          <label key={k} className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={paceDepth.curve.hazards[k]}
              onChange={(e) =>
                setPaceDepth((p) => ({
                  ...p,
                  curve: {
                    ...p.curve,
                    hazards: { ...p.curve.hazards, [k]: e.target.checked },
                  },
                }))
              }
            />
            <span style={{ fontSize: 12 }}>{l}</span>
          </label>
        ))}
        <label className="field">
          <span>
            节奏大纲（{paceDepth.curve.paceOutlineText.trim().length}/
            {paceDepth.curve.minOutlineChars}）
          </span>
          <textarea
            className="textarea"
            rows={5}
            value={paceDepth.curve.paceOutlineText}
            onChange={(e) =>
              setPaceDepth((p) => ({
                ...p,
                curve: { ...p.curve, paceOutlineText: e.target.value },
              }))
            }
          />
        </label>
      </Panel>

      <Panel title="情绪练习">
        <Badge tone={emoG.ok ? "ok" : "warn"}>{emoG.message}</Badge>
        {paceDepth.emotionLab.samples.map((s, idx) => (
          <label key={s.emotion} className="field">
            <span>
              {s.emotion}（{s.text.trim().length}/{s.minChars}）
            </span>
            <textarea
              className="textarea"
              rows={3}
              value={s.text}
              onChange={(e) =>
                setPaceDepth((p) => {
                  const samples = [...p.emotionLab.samples];
                  samples[idx] = { ...samples[idx]!, text: e.target.value };
                  return { ...p, emotionLab: { samples } };
                })
              }
            />
          </label>
        ))}
        <p className="muted" style={{ fontSize: 11 }}>
          四情绪：{FEMALE_EMOTION_KINDS.join(" / ")}；至少 3 段达标
        </p>
      </Panel>

      <Panel title="细节打磨">
        <Badge tone={detG.ok ? "ok" : "warn"}>{detG.message}</Badge>
        {(
          [
            ["personaDetail", "人设细节"],
            ["sceneSensory", "场景五觉"],
            ["microReaction", "情绪微反应"],
          ] as const
        ).map(([k, l]) => (
          <label key={k} className="field">
            <span>
              {l}（{paceDepth.detailLab[k].trim().length}/{paceDepth.detailLab.minChars}）
            </span>
            <textarea
              className="textarea"
              rows={2}
              value={paceDepth.detailLab[k]}
              onChange={(e) =>
                setPaceDepth((p) => ({
                  ...p,
                  detailLab: { ...p.detailLab, [k]: e.target.value },
                }))
              }
            />
          </label>
        ))}
      </Panel>

      <Panel title="避坑清单">
        <Badge tone={riskG.ok ? "ok" : "warn"}>{riskG.message}</Badge>
        <Button
          size="sm"
          onClick={() =>
            setPaceDepth((p) => ({
              ...p,
              riskList: {
                ...p.riskList,
                items: [
                  ...p.riskList.items,
                  { id: `r${Date.now()}`, text: "", category: "创作" },
                ],
              },
            }))
          }
        >
          加一条
        </Button>
        <Button
          size="sm"
          disabled={!projectId}
          onClick={() =>
            projectId &&
            void runAgentFeedback(projectId, "female.risk", { label: "female.risk" })
          }
        >
          female.risk
        </Button>
        {paceDepth.riskList.items.map((it, idx) => (
          <input
            key={it.id}
            className="input"
            value={it.text}
            placeholder={`避坑 ${idx + 1}`}
            onChange={(e) =>
              setPaceDepth((p) => {
                const items = [...p.riskList.items];
                items[idx] = { ...items[idx]!, text: e.target.value };
                return { ...p, riskList: { ...p.riskList, items } };
              })
            }
          />
        ))}
      </Panel>

      <Panel title="变现 / 改编">
        <Badge tone={monG.ok ? "ok" : "warn"}>{monG.message}</Badge>
        <label className="field">
          <span>平台</span>
          <Select
            className="select"
            value={paceDepth.monetize.platform}
            onChange={(e) =>
              setPaceDepth((p) => ({
                ...p,
                monetize: {
                  ...p.monetize,
                  platform: e.target.value as typeof p.monetize.platform,
                },
              }))
            }
          >
            <option value="">选择</option>
            <option value="阅文">阅文</option>
            <option value="番茄">番茄</option>
            <option value="晋江">晋江</option>
          </Select>
        </label>
        <div className="field-grid">
          <label className="field">
            <span>存稿章</span>
            <input
              className="input"
              type="number"
              value={paceDepth.monetize.stockChapters}
              onChange={(e) =>
                setPaceDepth((p) => ({
                  ...p,
                  monetize: {
                    ...p.monetize,
                    stockChapters: Number(e.target.value) || 0,
                  },
                }))
              }
            />
          </label>
          <label className="field">
            <span>日更字</span>
            <input
              className="input"
              type="number"
              value={paceDepth.monetize.dailyWordsMin}
              onChange={(e) =>
                setPaceDepth((p) => ({
                  ...p,
                  monetize: {
                    ...p.monetize,
                    dailyWordsMin: Number(e.target.value) || 0,
                  },
                }))
              }
            />
          </label>
        </div>
        <label className="field">
          <span>方案条目（逗号分隔，≥8）</span>
          <input
            className="input"
            value={paceDepth.monetize.planItems.join("，")}
            onChange={(e) =>
              setPaceDepth((p) => ({
                ...p,
                monetize: {
                  ...p.monetize,
                  planItems: e.target.value
                    .split(/[,，]/)
                    .map((x) => x.trim())
                    .filter(Boolean),
                },
              }))
            }
          />
        </label>
        <label className="field">
          <span>
            改编片段（{paceDepth.monetize.adaptFragment.trim().length}/
            {paceDepth.monetize.minAdaptChars}）
          </span>
          <textarea
            className="textarea"
            rows={4}
            value={paceDepth.monetize.adaptFragment}
            onChange={(e) =>
              setPaceDepth((p) => ({
                ...p,
                monetize: { ...p.monetize, adaptFragment: e.target.value },
              }))
            }
          />
        </label>
      </Panel>

      <Panel title="连载监控">
        <Badge tone={serG.ok ? "ok" : "warn"}>{serG.message}</Badge>
        <div className="field-grid">
          {(
            [
              ["actualCh1", "实测Ch1%"],
              ["actualCh10", "实测Ch10%"],
              ["actualCh50", "实测Ch50%"],
              ["actualCh100", "实测Ch100%"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="field">
              <span>{l}</span>
              <input
                className="input"
                type="number"
                value={paceDepth.serial[k] ?? ""}
                onChange={(e) =>
                  setPaceDepth((p) => ({
                    ...p,
                    serial: {
                      ...p.serial,
                      [k]: e.target.value === "" ? undefined : Number(e.target.value),
                    },
                  }))
                }
              />
            </label>
          ))}
        </div>
        <label className="field">
          <span>加快备案</span>
          <input
            className="input"
            value={paceDepth.serial.backupPlanFast}
            onChange={(e) =>
              setPaceDepth((p) => ({
                ...p,
                serial: { ...p.serial, backupPlanFast: e.target.value },
              }))
            }
          />
        </label>
        <label className="field">
          <span>放缓备案</span>
          <input
            className="input"
            value={paceDepth.serial.backupPlanSlow}
            onChange={(e) =>
              setPaceDepth((p) => ({
                ...p,
                serial: { ...p.serial, backupPlanSlow: e.target.value },
              }))
            }
          />
        </label>
        <label className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={paceDepth.serial.weeklyReviewNoted}
            onChange={(e) =>
              setPaceDepth((p) => ({
                ...p,
                serial: { ...p.serial, weeklyReviewNoted: e.target.checked },
              }))
            }
          />
          <span style={{ fontSize: 12 }}>7 日复盘已执行</span>
        </label>
      </Panel>
    </div>
  );
}
