/**
 * 九格基础课（9.md）短篇选题 + 处刑轻 QC。
 * 不重建 L4/L6 爽点引擎；导语为知乎~200字轨（与 L5 分轨）。
 */
import {
  AUDIENCE_BUCKET_LABELS,
  EXECUTION_QC_TAGS,
  GOLDEN_THREE_SECONDS,
  SENSE_TAG_OPTIONS,
  TOPIC_SELECTION_CHECKPOINTS,
  summarizeTopicSelectionToMaster,
  topicSelectionWorkflowCompleteness,
  validateAudienceExclusive,
  validateFivePitfalls,
  validateIntroOverstuff,
  validateMasterBeatCount,
  type AudienceBucket,
  type MasterOutlineBody,
  type TopicSelectionWorkflow,
} from "@xiezuomanju/domain";
import { Badge, Button, Panel, Tabs } from "@xiezuomanju/ui";
import { useMemo, type Dispatch, type SetStateAction } from "react";
import { runAgentFeedback } from "./runAgentFeedback";
import { usePersistedState } from "./usePersistedState";

export function emptyTopicSelection(): TopicSelectionWorkflow {
  return {
    schemaVersion: "nines-9.md/1",
    currentStep: 0,
    audience: {
      antiTrope: false,
      womenMutual: false,
      softScifiGrounded: false,
      antiFloatingSweet: false,
      realistSmoke: false,
      slowPace: false,
      audioOriented: false,
      exclusiveConfirmed: false,
    },
    chart: {
      platform: "",
      chartType: "",
      topKeywords: [],
      repeatWords: [],
      diffNote: "",
      onlySettingKeywordCoreHint: "只扒核心设定+关键词+扫内核，勿抄全文",
    },
    formula: {
      oldTropeOrHot: "",
      strengthDomain: "",
      emotionPoint: "",
      diffOneLiner: "",
      multiEndingNote: "",
    },
    contrast: { baseTrope: "", alienElement: "", logicSelfCheck: false, note: "" },
    hotspot: {
      canLand: false,
      hasEmotion: false,
      hasDepth: false,
      positiveReviewOk: false,
      note: "",
    },
    twists: {
      openingTwist: "",
      midTwist: "",
      endingTwist: "",
      foreshadowPreDesigned: false,
      note: "",
    },
    intro: {
      text: "",
      targetChars: 200,
      senseTags: [],
      coolSentenceMarked: false,
      overstuffWarned: false,
      trackNote: "知乎导语轨~200字；与 L5 导语四轴分轨互标",
    },
    beatRail: {
      slots: [],
      minSlots: 11,
      maxSlots: 13,
      note: "全书故事情节 11–13；≠ L8 章内情节点",
    },
    pitfalls: {
      noFloating: false,
      noMelodrama: false,
      noAuthorOpinionInText: false,
      noCopycat: false,
      audienceClear: false,
    },
    executionQc: {
      coreConflictTaughtToAi: false,
      visualSenseOk: false,
      fiveSensesOk: false,
      coolEscalationLinkedL6: false,
      punctDeAiLinked: false,
      pronounStrict: false,
      climaxNotAbrupt: false,
      note: "处刑轻台：链 L6 / DeAi",
    },
    postSubmit: {
      restHours: 2,
      readToOther: false,
      logicVsEditorTasteNote: "",
      submitted: false,
    },
    handedOffToL8: false,
    notes: "",
  };
}

type Ctl = {
  projectId?: string;
  wf?: TopicSelectionWorkflow;
  setWf?: Dispatch<SetStateAction<TopicSelectionWorkflow>>;
};

function useTs(props: Ctl) {
  const persisted = usePersistedState(
    props.projectId,
    "topic-selection-wf",
    emptyTopicSelection(),
  );
  if (props.wf && props.setWf) return [props.wf, props.setWf] as const;
  return persisted;
}

export function ExecutionQcLitePanel(props: Ctl) {
  const [wf, setWf] = useTs(props);
  const keys = [
    ["coreConflictTaughtToAi", "核心矛盾已教懂 AI"],
    ["visualSenseOk", "画面感"],
    ["fiveSensesOk", "五觉"],
    ["coolEscalationLinkedL6", "爽点递进（链 L6）"],
    ["punctDeAiLinked", "标点去 AI（链 DeAi）"],
    ["pronounStrict", "代词严谨"],
    ["climaxNotAbrupt", "高潮勿戛然"],
  ] as const;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        处刑标签：{EXECUTION_QC_TAGS.join(" · ")}。不复制打脸表单。
      </p>
      {keys.map(([k, label]) => (
        <label key={k} className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={wf.executionQc[k]}
            onChange={(e) =>
              setWf((s) => ({
                ...s,
                executionQc: { ...s.executionQc, [k]: e.target.checked },
              }))
            }
          />
          <span style={{ fontSize: 12 }}>{label}</span>
        </label>
      ))}
    </div>
  );
}

export function TopicSelectionWorkbench({
  projectId,
  onSyncMaster,
}: {
  projectId?: string;
  onSyncMaster?: (thin: ReturnType<typeof summarizeTopicSelectionToMaster>) => void;
}) {
  const [wf, setWf] = useTs({ projectId });
  const score = useMemo(() => topicSelectionWorkflowCompleteness(wf), [wf]);
  const [tab, setTab] = usePersistedState(projectId, "ts-l9-tab", "overview");
  const aud = validateAudienceExclusive(wf.audience);
  const intro = validateIntroOverstuff(wf.intro);
  const beats = validateMasterBeatCount(wf.beatRail);
  const pits = validateFivePitfalls(wf.pitfalls);

  const syncThin = () => {
    const thin = summarizeTopicSelectionToMaster(wf);
    onSyncMaster?.(thin);
    if (projectId) {
      try {
        const key = `deep:${projectId}:master-outline`;
        const prev = localStorage.getItem(key);
        const base = prev ? (JSON.parse(prev) as MasterOutlineBody) : {};
        localStorage.setItem(key, JSON.stringify({ ...base, ...thin }));
      } catch {
        /* ignore */
      }
    }
  };

  return (
    <Panel
      title="短篇选题（9.md 十步）"
      actions={
        <div className="row" style={{ gap: 6 }}>
          <Badge>
            {score.filledSteps}/{score.totalSteps}
          </Badge>
          <Button size="sm" onClick={syncThin}>
            回写总纲摘要
          </Button>
        </div>
      }
    >
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        {GOLDEN_THREE_SECONDS}。选题完成后汇入 L8；爽点/画面验收链 L4/L6，勿重复造轮。
      </p>
      {score.missing.length > 0 && (
        <Badge tone="warn">未完成：{score.missing.join("、")}</Badge>
      )}
      <div className="row" style={{ flexWrap: "wrap", gap: 6, margin: "8px 0" }}>
        {TOPIC_SELECTION_CHECKPOINTS.map((cp, i) => (
          <button
            key={cp.id}
            type="button"
            className="btn btn-sm"
            style={{
              outline: wf.currentStep === i ? "2px solid var(--accent, #126b5b)" : undefined,
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
          { id: "audience", label: "受众" },
          { id: "chart", label: "扒榜" },
          { id: "formula", label: "公式/反差" },
          { id: "twist", label: "反转" },
          { id: "intro", label: "导语" },
          { id: "beats", label: "情节轨" },
          { id: "qc", label: "处刑QC" },
          { id: "submit", label: "五坑/投稿" },
        ]}
      />
      {tab === "overview" && (
        <div className="stack" style={{ gap: 8 }}>
          <Badge tone={aud.ok ? "ok" : "warn"}>{aud.message}</Badge>
          <Badge tone={intro.ok ? "ok" : "warn"}>{intro.message}</Badge>
          <Badge tone={beats.ok ? "ok" : "fail"}>{beats.message}</Badge>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={wf.handedOffToL8}
              onChange={(e) => setWf((s) => ({ ...s, handedOffToL8: e.target.checked }))}
            />
            <span style={{ fontSize: 12 }}>已汇入 L8 灵感总装</span>
          </label>
        </div>
      )}
      {tab === "audience" && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 6 }}>
            {(["young_18_35", "mature_40plus"] as AudienceBucket[]).map((b) => (
              <button
                key={b}
                type="button"
                className="btn btn-sm"
                style={{
                  outline: wf.audience.bucket === b ? "2px solid var(--accent)" : undefined,
                }}
                onClick={() => setWf((s) => ({ ...s, audience: { ...s.audience, bucket: b } }))}
              >
                {AUDIENCE_BUCKET_LABELS[b]}
              </button>
            ))}
          </div>
          {wf.audience.bucket === "young_18_35" &&
            (
              [
                ["antiTrope", "反套路"],
                ["womenMutual", "女性互助"],
                ["softScifiGrounded", "轻科幻扎根现实"],
                ["antiFloatingSweet", "反悬浮甜宠"],
              ] as const
            ).map(([k, l]) => (
              <label key={k} className="row" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={wf.audience[k]}
                  onChange={(e) =>
                    setWf((s) => ({
                      ...s,
                      audience: { ...s.audience, [k]: e.target.checked },
                    }))
                  }
                />
                <span style={{ fontSize: 12 }}>{l}</span>
              </label>
            ))}
          {wf.audience.bucket === "mature_40plus" &&
            (
              [
                ["realistSmoke", "现实烟火"],
                ["slowPace", "慢节奏"],
                ["audioOriented", "有声向"],
              ] as const
            ).map(([k, l]) => (
              <label key={k} className="row" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={wf.audience[k]}
                  onChange={(e) =>
                    setWf((s) => ({
                      ...s,
                      audience: { ...s.audience, [k]: e.target.checked },
                    }))
                  }
                />
                <span style={{ fontSize: 12 }}>{l}</span>
              </label>
            ))}
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={wf.audience.exclusiveConfirmed}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  audience: { ...s.audience, exclusiveConfirmed: e.target.checked },
                }))
              }
            />
            <span style={{ fontSize: 12 }}>确认只选一边受众</span>
          </label>
        </div>
      )}
      {tab === "chart" && (
        <div className="field-grid">
          <label className="field">
            <span>平台</span>
            <input
              className="input"
              value={wf.chart.platform}
              onChange={(e) =>
                setWf((s) => ({ ...s, chart: { ...s.chart, platform: e.target.value } }))
              }
            />
          </label>
          <label className="field">
            <span>榜类型</span>
            <input
              className="input"
              value={wf.chart.chartType}
              onChange={(e) =>
                setWf((s) => ({ ...s, chart: { ...s.chart, chartType: e.target.value } }))
              }
            />
          </label>
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span>前20关键词（换行）</span>
            <textarea
              className="textarea"
              rows={3}
              value={wf.chart.topKeywords.join("\n")}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  chart: {
                    ...s.chart,
                    topKeywords: e.target.value.split("\n").filter(Boolean),
                  },
                }))
              }
            />
          </label>
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span>差异化笔记</span>
            <textarea
              className="textarea"
              rows={2}
              value={wf.chart.diffNote}
              onChange={(e) =>
                setWf((s) => ({ ...s, chart: { ...s.chart, diffNote: e.target.value } }))
              }
            />
          </label>
          <p className="muted" style={{ fontSize: 11 }}>
            {wf.chart.onlySettingKeywordCoreHint}
          </p>
        </div>
      )}
      {tab === "formula" && (
        <div className="stack" style={{ gap: 8 }}>
          {(
            [
              ["oldTropeOrHot", "老梗/热点"],
              ["strengthDomain", "擅长领域"],
              ["emotionPoint", "情绪点"],
              ["diffOneLiner", "差异化一句话"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="field">
              <span>{l}</span>
              <input
                className="input"
                value={wf.formula[k]}
                onChange={(e) =>
                  setWf((s) => ({ ...s, formula: { ...s.formula, [k]: e.target.value } }))
                }
              />
            </label>
          ))}
          <Panel title="反差缝合">
            <label className="field">
              <span>基底梗</span>
              <input
                className="input"
                value={wf.contrast.baseTrope}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    contrast: { ...s.contrast, baseTrope: e.target.value },
                  }))
                }
              />
            </label>
            <label className="field">
              <span>异质元素</span>
              <input
                className="input"
                value={wf.contrast.alienElement}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    contrast: { ...s.contrast, alienElement: e.target.value },
                  }))
                }
              />
            </label>
            <label className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={wf.contrast.logicSelfCheck}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    contrast: { ...s.contrast, logicSelfCheck: e.target.checked },
                  }))
                }
              />
              <span style={{ fontSize: 12 }}>逻辑自洽已检</span>
            </label>
            <Button
              size="sm"
              variant="primary"
              disabled={
                !projectId ||
                !wf.contrast.baseTrope.trim() ||
                !wf.contrast.alienElement.trim()
              }
              onClick={() =>
                projectId &&
                void runAgentFeedback(projectId, "topic.core_hook_batch", {
                  label: "老梗×元素缝合批量",
                  inputJson: {
                    seed: `基底梗：${wf.contrast.baseTrope}\n异质元素：${wf.contrast.alienElement}\n要求：逻辑自洽的反差缝合微创新`,
                    count: 10,
                  },
                })
              }
            >
              批量缝合出梗（复用 core_hook_batch）
            </Button>
          </Panel>
          <Panel title="热点落地">
            {(
              [
                ["canLand", "可落地"],
                ["hasEmotion", "有情绪"],
                ["hasDepth", "有深度"],
                ["positiveReviewOk", "政审正向"],
              ] as const
            ).map(([k, l]) => (
              <label key={k} className="row" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={wf.hotspot[k]}
                  onChange={(e) =>
                    setWf((s) => ({
                      ...s,
                      hotspot: { ...s.hotspot, [k]: e.target.checked },
                    }))
                  }
                />
                <span style={{ fontSize: 12 }}>{l}</span>
              </label>
            ))}
          </Panel>
        </div>
      )}
      {tab === "twist" && (
        <div className="stack" style={{ gap: 8 }}>
          {(
            [
              ["openingTwist", "开篇反转"],
              ["midTwist", "中段小反转"],
              ["endingTwist", "结尾大反转"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="field">
              <span>{l}</span>
              <textarea
                className="textarea"
                rows={2}
                value={wf.twists[k]}
                onChange={(e) =>
                  setWf((s) => ({ ...s, twists: { ...s.twists, [k]: e.target.value } }))
                }
              />
            </label>
          ))}
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={wf.twists.foreshadowPreDesigned}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  twists: { ...s.twists, foreshadowPreDesigned: e.target.checked },
                }))
              }
            />
            <span style={{ fontSize: 12 }}>伏笔预先设计</span>
          </label>
        </div>
      )}
      {tab === "intro" && (
        <div className="stack" style={{ gap: 8 }}>
          <Badge tone={intro.ok ? "ok" : "warn"}>
            {intro.message}（{intro.charCount}字）
          </Badge>
          <p className="muted" style={{ fontSize: 11, margin: 0 }}>
            {wf.intro.trackNote}
          </p>
          <textarea
            className="textarea"
            rows={5}
            value={wf.intro.text}
            onChange={(e) =>
              setWf((s) => ({ ...s, intro: { ...s.intro, text: e.target.value } }))
            }
          />
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {SENSE_TAG_OPTIONS.map((tag) => (
              <label key={tag} className="row" style={{ gap: 4 }}>
                <input
                  type="checkbox"
                  checked={wf.intro.senseTags.includes(tag)}
                  onChange={(e) =>
                    setWf((s) => {
                      const senseTags = e.target.checked
                        ? [...s.intro.senseTags, tag]
                        : s.intro.senseTags.filter((t) => t !== tag);
                      return { ...s, intro: { ...s.intro, senseTags } };
                    })
                  }
                />
                <span style={{ fontSize: 12 }}>{tag}</span>
              </label>
            ))}
          </div>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={wf.intro.coolSentenceMarked}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  intro: { ...s.intro, coolSentenceMarked: e.target.checked },
                }))
              }
            />
            <span style={{ fontSize: 12 }}>已标爽点句</span>
          </label>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={wf.intro.overstuffWarned}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  intro: { ...s.intro, overstuffWarned: e.target.checked },
                }))
              }
            />
            <span style={{ fontSize: 12 }}>塞太满预警（勾选则不过关）</span>
          </label>
        </div>
      )}
      {tab === "beats" && (
        <div className="stack" style={{ gap: 8 }}>
          <Badge tone={beats.ok ? "ok" : "fail"}>{beats.message}</Badge>
          <p className="muted" style={{ fontSize: 11 }}>
            {wf.beatRail.note}
          </p>
          <Button
            size="sm"
            onClick={() =>
              setWf((s) => ({
                ...s,
                beatRail: {
                  ...s.beatRail,
                  slots: [
                    ...s.beatRail.slots,
                    {
                      id: `b-${Date.now()}`,
                      qi: "",
                      cheng: "",
                      zhuan: "",
                      he: "",
                      done: false,
                    },
                  ],
                },
              }))
            }
          >
            加情节槽
          </Button>
          {wf.beatRail.slots.map((slot, i) => (
            <Panel key={slot.id} title={`故事情节 ${i + 1}`}>
              <div className="field-grid">
                {(["qi", "cheng", "zhuan", "he"] as const).map((k) => (
                  <label key={k} className="field">
                    <span>{k === "qi" ? "起" : k === "cheng" ? "承" : k === "zhuan" ? "转" : "合"}</span>
                    <input
                      className="input"
                      value={slot[k]}
                      onChange={(e) => {
                        const slots = [...wf.beatRail.slots];
                        slots[i] = { ...slot, [k]: e.target.value };
                        setWf((s) => ({ ...s, beatRail: { ...s.beatRail, slots } }));
                      }}
                    />
                  </label>
                ))}
                <label className="row" style={{ gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={slot.done}
                    onChange={(e) => {
                      const slots = [...wf.beatRail.slots];
                      slots[i] = { ...slot, done: e.target.checked };
                      setWf((s) => ({ ...s, beatRail: { ...s.beatRail, slots } }));
                    }}
                  />
                  <span style={{ fontSize: 12 }}>完成</span>
                </label>
              </div>
            </Panel>
          ))}
        </div>
      )}
      {tab === "qc" && <ExecutionQcLitePanel projectId={projectId} wf={wf} setWf={setWf} />}
      {tab === "submit" && (
        <div className="stack" style={{ gap: 8 }}>
          <Badge tone={pits.ok ? "ok" : "warn"}>{pits.message}</Badge>
          {(
            [
              ["noFloating", "禁悬浮"],
              ["noMelodrama", "禁狗血"],
              ["noAuthorOpinionInText", "禁作者观点入文"],
              ["noCopycat", "禁跟风抄袭"],
              ["audienceClear", "受众清晰"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={wf.pitfalls[k]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    pitfalls: { ...s.pitfalls, [k]: e.target.checked },
                  }))
                }
              />
              <span style={{ fontSize: 12 }}>{l}</span>
            </label>
          ))}
          <label className="field">
            <span>静置小时（≥2）</span>
            <input
              className="input"
              type="number"
              min={0}
              value={wf.postSubmit.restHours}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  postSubmit: {
                    ...s.postSubmit,
                    restHours: Number(e.target.value) || 0,
                  },
                }))
              }
            />
          </label>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={wf.postSubmit.readToOther}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  postSubmit: { ...s.postSubmit, readToOther: e.target.checked },
                }))
              }
            />
            <span style={{ fontSize: 12 }}>已读给旁人</span>
          </label>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={wf.postSubmit.submitted}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  postSubmit: { ...s.postSubmit, submitted: e.target.checked },
                }))
              }
            />
            <span style={{ fontSize: 12 }}>已投稿/准备投稿</span>
          </label>
        </div>
      )}
    </Panel>
  );
}
