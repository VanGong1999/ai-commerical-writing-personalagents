/**
 * 17.md 漫剧进阶二：元素叠加 / 百集四幕 / 开场·钩子 / 桥段 / 趋势。
 * 复用 topic.core_hook_batch、struct.act100_manju；不塞 Beat20。
 */
import {
  DEFAULT_ACT100_SEGMENTS,
  ENDING_HOOK_FIVE,
  MANJU_ADVANCED_CHECKPOINTS,
  MANJU_RENDER_FORMATS,
  ManjuAdvancedWorkflowSchema,
  manjuAdvancedCompleteness,
  OPENING_NINE_TYPES,
  summarizeManjuAdvancedToMaster,
  validateAct100Tasks,
  validateElementCombo,
  validateEpisodeCraft,
  type Act100Segment,
  type ManjuAdvancedWorkflow,
  type MasterOutlineBody,
} from "@xiezuomanju/domain";
import { Badge, Button, Panel, Tabs } from "@xiezuomanju/ui";
import { Select } from "@xiezuomanju/ui";
import { useEffect, useMemo } from "react";
import { runAgentFeedback } from "./runAgentFeedback";
import { usePersistedState } from "./usePersistedState";

export function emptyManjuAdvanced(): ManjuAdvancedWorkflow {
  return ManjuAdvancedWorkflowSchema.parse({});
}

/** 可编辑百集四幕任务表 + Agent 导入；替换薄 Act100Panel */
export function Act100Workbench({
  projectId,
  act100,
  setAct100,
}: {
  projectId?: string;
  act100: ManjuAdvancedWorkflow["act100"];
  setAct100: (
    updater: (t: ManjuAdvancedWorkflow["act100"]) => ManjuAdvancedWorkflow["act100"],
  ) => void;
}) {
  const gate = validateAct100Tasks(act100);
  return (
    <Panel
      title="100 集四幕任务表（17.md）"
      actions={<Badge tone={gate.ok ? "ok" : "warn"}>{gate.message}</Badge>}
    >
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        扩展用，不挡前十集投稿。第三幕=低谷+绝地反击。可导入 struct.act100_manju。
      </p>
      <div className="row" style={{ gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <Button
          size="sm"
          disabled={!projectId}
          onClick={() => {
            if (!projectId) return;
            setAct100((t) => ({ ...t, importedFromAgent: true }));
            void runAgentFeedback(projectId, "struct.act100_manju", {
              label: "struct.act100_manju",
              inputJson: { segments: act100.segments },
            });
          }}
        >
          生成/导入四幕骨架
        </Button>
        <Button
          size="sm"
          onClick={() =>
            setAct100(() => ({
              segments: DEFAULT_ACT100_SEGMENTS.map((s) => ({ ...s })),
              importedFromAgent: false,
            }))
          }
        >
          重置讲义默认段
        </Button>
        {act100.importedFromAgent ? <Badge tone="ok">已标 Agent 导入</Badge> : null}
      </div>
      <div className="stack" style={{ gap: 8 }}>
        {act100.segments.map((seg, i) => (
          <div key={seg.id} className="field-grid">
            <label className="field">
              <span>幕</span>
              <input
                className="input"
                type="number"
                min={1}
                max={4}
                value={seg.act}
                onChange={(e) => {
                  const segments = [...act100.segments];
                  segments[i] = { ...seg, act: Number(e.target.value) || 1 };
                  setAct100((t) => ({ ...t, segments }));
                }}
              />
            </label>
            <label className="field">
              <span>集起</span>
              <input
                className="input"
                type="number"
                min={1}
                value={seg.epFrom}
                onChange={(e) => {
                  const segments = [...act100.segments];
                  segments[i] = { ...seg, epFrom: Number(e.target.value) || 1 };
                  setAct100((t) => ({ ...t, segments }));
                }}
              />
            </label>
            <label className="field">
              <span>集止</span>
              <input
                className="input"
                type="number"
                min={1}
                value={seg.epTo}
                onChange={(e) => {
                  const segments = [...act100.segments];
                  segments[i] = { ...seg, epTo: Number(e.target.value) || 1 };
                  setAct100((t) => ({ ...t, segments }));
                }}
              />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>任务</span>
              <input
                className="input"
                value={seg.task}
                onChange={(e) => {
                  const segments = [...act100.segments];
                  segments[i] = { ...seg, task: e.target.value };
                  setAct100((t) => ({ ...t, segments }));
                }}
              />
            </label>
            <label className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={seg.done}
                onChange={(e) => {
                  const segments = [...act100.segments];
                  segments[i] = { ...seg, done: e.target.checked };
                  setAct100((t) => ({ ...t, segments }));
                }}
              />
              <span style={{ fontSize: 12 }}>段完成</span>
            </label>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function ManjuAdvancedWorkbench({ projectId }: { projectId?: string }) {
  const [wf, setWf] = usePersistedState(projectId, "manju-advanced-wf", emptyManjuAdvanced());
  useEffect(() => {
    setWf((s) => ManjuAdvancedWorkflowSchema.parse(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  const score = useMemo(() => manjuAdvancedCompleteness(wf), [wf]);
  const [tab, setTab] = usePersistedState(projectId, "ma-l17-tab", "overview");
  const comboG = validateElementCombo(wf.combo);
  const actG = validateAct100Tasks(wf.act100);
  const craftG = validateEpisodeCraft(wf.episodeCraft);

  const syncThin = () => {
    if (!projectId) return;
    try {
      const thin = summarizeManjuAdvancedToMaster(wf);
      const key = `deep:${projectId}:master-outline`;
      const prev = localStorage.getItem(key);
      const base = prev ? (JSON.parse(prev) as MasterOutlineBody) : {};
      localStorage.setItem(key, JSON.stringify({ ...base, ...thin }));
    } catch {
      /* ignore */
    }
  };

  const seedText = [
    `世界观：${wf.combo.worldview}`,
    `身份反差：${wf.combo.identityContrast}`,
    `限制金手指：${wf.combo.limitedGoldFinger}`,
    `核心动作：${wf.combo.coreAction}`,
    wf.combo.renderFormat ? `形式：${wf.combo.renderFormat}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <Panel
      title="漫剧进阶二（17.md）"
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
        四步法/百集四幕/开场钩子；前十权威仍在 L11。不塞 Beat20，不改 IP 卡点语义。
      </p>
      {score.missing.length > 0 && (
        <Badge tone="warn">未完成：{score.missing.join("、")}</Badge>
      )}
      <div className="row" style={{ flexWrap: "wrap", gap: 6, margin: "8px 0" }}>
        {MANJU_ADVANCED_CHECKPOINTS.map((cp, i) => (
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
          { id: "combo", label: "元素叠加" },
          { id: "act100", label: "百集四幕" },
          { id: "craft", label: "开场/钩子" },
          { id: "trope", label: "桥段/趋势" },
        ]}
      />
      {tab === "overview" && (
        <div className="stack" style={{ gap: 6 }}>
          <Badge tone={comboG.ok ? "ok" : "warn"}>{comboG.message}</Badge>
          <Badge tone={actG.ok ? "ok" : "warn"}>{actG.message}</Badge>
          <Badge tone={craftG.ok ? "ok" : "warn"}>{craftG.message}</Badge>
          <Badge
            tone={
              wf.trendAck.followHot &&
              wf.trendAck.pitchFastStudio &&
              wf.trendAck.formatMatch
                ? "ok"
                : "warn"
            }
          >
            趋势三勾
            {wf.trendAck.followHot &&
            wf.trendAck.pitchFastStudio &&
            wf.trendAck.formatMatch
              ? "齐"
              : "未齐"}
          </Badge>
        </div>
      )}
      {tab === "combo" && (
        <div className="stack" style={{ gap: 8 }}>
          <p className="muted" style={{ fontSize: 11, margin: 0 }}>
            种子只读来自讲义库常量思路；批量走既有 topic.core_hook_batch（与 FourStepCombo 同链）。
          </p>
          {(
            [
              ["worldview", "世界观"],
              ["identityContrast", "身份反差"],
              ["limitedGoldFinger", "限制金手指"],
              ["coreAction", "核心动作/追剧点"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="field">
              <span>{l}</span>
              <input
                className="input"
                value={wf.combo[k]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    combo: { ...s.combo, [k]: e.target.value },
                  }))
                }
              />
            </label>
          ))}
          <label className="field">
            <span>表现形式</span>
            <Select
              className="select"
              value={wf.combo.renderFormat}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  combo: {
                    ...s.combo,
                    renderFormat: e.target.value as typeof s.combo.renderFormat,
                  },
                }))
              }
            >
              <option value="">未选</option>
              {MANJU_RENDER_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          </label>
          <label className="field">
            <span>种子备注（只读思路）</span>
            <textarea
              className="textarea"
              rows={2}
              value={wf.combo.seedNote}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  combo: { ...s.combo, seedNote: e.target.value },
                }))
              }
            />
          </label>
          <Button
            variant="primary"
            disabled={!comboG.ok || !projectId}
            onClick={() =>
              projectId &&
              void runAgentFeedback(projectId, "topic.core_hook_batch", {
                label: "topic.core_hook_batch",
                inputJson: {
                  seed: seedText,
                  fourStep: {
                    world: wf.combo.worldview,
                    identityGap: wf.combo.identityContrast,
                    goldFinger: wf.combo.limitedGoldFinger,
                    coreAction: wf.combo.coreAction,
                  },
                  renderFormat: wf.combo.renderFormat,
                  count: 10,
                },
              })
            }
          >
            用叠加种子批量生成核心梗
          </Button>
        </div>
      )}
      {tab === "act100" && (
        <Act100Workbench
          projectId={projectId}
          act100={wf.act100}
          setAct100={(updater) => setWf((s) => ({ ...s, act100: updater(s.act100) }))}
        />
      )}
      {tab === "craft" && (
        <div className="stack" style={{ gap: 8 }}>
          <p className="muted" style={{ fontSize: 11, margin: 0 }}>
            开场九型之一 + 集尾钩子五法之一；至少 3 集齐备。
          </p>
          <Button
            size="sm"
            onClick={() =>
              setWf((s) => ({
                ...s,
                episodeCraft: [
                  ...s.episodeCraft,
                  {
                    id: `ec-${Date.now()}`,
                    episodeNo: s.episodeCraft.length + 1,
                    openingType: "",
                    endingHook: "",
                    note: "",
                  },
                ],
              }))
            }
          >
            加练习行
          </Button>
          {wf.episodeCraft.map((row, i) => (
            <div key={row.id} className="field-grid">
              <label className="field">
                <span>集号</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={row.episodeNo}
                  onChange={(e) => {
                    const episodeCraft = [...wf.episodeCraft];
                    episodeCraft[i] = {
                      ...row,
                      episodeNo: Number(e.target.value) || 1,
                    };
                    setWf((s) => ({ ...s, episodeCraft }));
                  }}
                />
              </label>
              <label className="field">
                <span>开场九型</span>
                <Select
                  className="select"
                  value={row.openingType}
                  onChange={(e) => {
                    const episodeCraft = [...wf.episodeCraft];
                    episodeCraft[i] = { ...row, openingType: e.target.value };
                    setWf((s) => ({ ...s, episodeCraft }));
                  }}
                >
                  <option value="">未选</option>
                  {OPENING_NINE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="field">
                <span>集尾钩子五法</span>
                <Select
                  className="select"
                  value={row.endingHook}
                  onChange={(e) => {
                    const episodeCraft = [...wf.episodeCraft];
                    episodeCraft[i] = { ...row, endingHook: e.target.value };
                    setWf((s) => ({ ...s, episodeCraft }));
                  }}
                >
                  <option value="">未选</option>
                  {ENDING_HOOK_FIVE.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="field" style={{ gridColumn: "1 / -1" }}>
                <span>备注</span>
                <input
                  className="input"
                  value={row.note}
                  onChange={(e) => {
                    const episodeCraft = [...wf.episodeCraft];
                    episodeCraft[i] = { ...row, note: e.target.value };
                    setWf((s) => ({ ...s, episodeCraft }));
                  }}
                />
              </label>
            </div>
          ))}
          <Badge tone={craftG.ok ? "ok" : "warn"}>{craftG.message}</Badge>
        </div>
      )}
      {tab === "trope" && (
        <div className="stack" style={{ gap: 8 }}>
          <p className="muted" style={{ fontSize: 11, margin: 0 }}>
            桥段微练习 ≠ Charlie bridge8。趋势：跟热点 / 投快公司 / 形式匹配。
          </p>
          {(
            [
              ["infoGapIntrigue", "权谋信息差"],
              ["sweetSpotlight", "甜宠名场面"],
              ["coolBeat", "爽点桥"],
              ["tearBeat", "催泪桥"],
              ["comedyBeat", "喜感桥"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={wf.tropeDrill[k]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    tropeDrill: { ...s.tropeDrill, [k]: e.target.checked },
                  }))
                }
              />
              <span style={{ fontSize: 12 }}>{l}</span>
            </label>
          ))}
          <label className="field">
            <span>桥段短备注</span>
            <textarea
              className="textarea"
              rows={2}
              value={wf.tropeDrill.note}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  tropeDrill: { ...s.tropeDrill, note: e.target.value },
                }))
              }
            />
          </label>
          <strong style={{ fontSize: 13 }}>趋势投稿三勾</strong>
          {(
            [
              ["followHot", "跟热点"],
              ["pitchFastStudio", "投快公司"],
              ["formatMatch", "形式匹配"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={wf.trendAck[k]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    trendAck: { ...s.trendAck, [k]: e.target.checked },
                  }))
                }
              />
              <span style={{ fontSize: 12 }}>{l}</span>
            </label>
          ))}
        </div>
      )}
    </Panel>
  );
}

/** Format / Manju outline 栈挂载入口 */
export function NinesLesson17Panels({ projectId }: { projectId?: string }) {
  return <ManjuAdvancedWorkbench projectId={projectId} />;
}

export type { Act100Segment };
