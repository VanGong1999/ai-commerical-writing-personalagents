/**
 * 九格 12.md 漫剧题材轨：升级/反套路/后悔 + 收藏>5万 + 提炼内核。
 * 深化 SettingWorkbench；≠ topic.story_shell 短剧四壳。
 */
import {
  MANJU_DISCOURAGED_TOPICS,
  MANJU_GENRE_TRACK_CHECKPOINTS,
  MANJU_GENRE_TRACK_LABELS,
  manjuGenreTrackWorkflowCompleteness,
  summarizeManjuGenreTrackToMaster,
  validateBenchmarkCollection,
  validateGenreTrackFill,
  validateKernelExtract,
  type ManjuGenreTrackKind,
  type ManjuGenreTrackWorkflow,
  type MasterOutlineBody,
} from "@xiezuomanju/domain";
import { Badge, Button, Panel, Tabs } from "@xiezuomanju/ui";
import { useMemo } from "react";
import { SettingWorkbench } from "./DeepMethodPanels";
import { usePersistedState } from "./usePersistedState";

export function emptyManjuGenreTrack(): ManjuGenreTrackWorkflow {
  return {
    schemaVersion: "nines-12.md/1",
    currentStep: 0,
    upgrade: {
      buffStack: "",
      strike: "",
      goldFingerOn: "",
      revengeMain: "",
      growSameTier: "",
      developCross: "",
      climax: "",
    },
    antiTrope: {
      characterLayer: "",
      plotLayer: "",
      worldLayer: "",
      writeToPlotLayer: true,
      tropeStockNoted: false,
    },
    regret: {
      passiveWaitRegret: "",
      payHistoryFull: "",
      openingBuffStack: "",
      contrastWithUpgrade: "",
    },
    quota: {
      openingEps: 4,
      growEps: 10,
      developEps: 10,
      climaxEps: 1,
      note: "开场3–5 / 成长10 / 发展10 / 高潮1",
    },
    discouraged: { avoided: [], allChecked: false },
    benchmark: {
      title: "",
      collectionCount: 0,
      threshold: 50000,
      deepDissectOk: false,
      note: "",
    },
    kernel: {
      humanFive: { who: "", world: "", power: "", conflict: "", reward: "" },
      aiFiveBrief: "",
      compared: false,
      note: "",
    },
    genderHint: {
      female: "女频：重制作/讨喜/情感线",
      male: "男频：事业线；主角可不那么讨喜",
      acknowledged: false,
    },
    settingPackLinked: false,
    notes: "",
  };
}

export function ManjuGenreTrackWorkbench({
  projectId,
  initialTrack,
}: {
  projectId?: string;
  initialTrack?: ManjuGenreTrackKind;
}) {
  const [wf, setWf] = usePersistedState(projectId, "manju-genre-track-wf", {
    ...emptyManjuGenreTrack(),
    track: initialTrack,
  });
  const score = useMemo(() => manjuGenreTrackWorkflowCompleteness(wf), [wf]);
  const [tab, setTab] = usePersistedState(projectId, "gt-l12-tab", "overview");
  const fill = validateGenreTrackFill(wf);
  const bench = validateBenchmarkCollection(wf.benchmark);
  const kernel = validateKernelExtract(wf.kernel);

  const syncThin = () => {
    if (!projectId) return;
    try {
      const thin = summarizeManjuGenreTrackToMaster(wf);
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
      title="漫剧题材轨（12.md）"
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
        Inspiration「升级/反套路/后悔」壳 ≠ 短剧 topic.story_shell。设定包五要素在下方嵌入复用。
      </p>
      {score.missing.length > 0 && (
        <Badge tone="warn">未完成：{score.missing.join("、")}</Badge>
      )}
      <div className="row" style={{ flexWrap: "wrap", gap: 6, margin: "8px 0" }}>
        {MANJU_GENRE_TRACK_CHECKPOINTS.map((cp, i) => (
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
          { id: "track", label: "题材框架" },
          { id: "bench", label: "对标/避坑" },
          { id: "kernel", label: "提炼内核" },
          { id: "setting", label: "设定包" },
        ]}
      />
      {tab === "overview" && (
        <div className="stack" style={{ gap: 6 }}>
          <Badge tone={fill.ok ? "ok" : "warn"}>{fill.message}</Badge>
          <Badge tone={bench.ok ? "ok" : "warn"}>{bench.message}</Badge>
          <Badge tone={kernel.ok ? "ok" : "warn"}>{kernel.message}</Badge>
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {(Object.keys(MANJU_GENRE_TRACK_LABELS) as ManjuGenreTrackKind[]).map((t) => (
              <button
                key={t}
                type="button"
                className="btn btn-sm"
                style={{
                  outline: wf.track === t ? "2px solid var(--accent)" : undefined,
                }}
                onClick={() => setWf((s) => ({ ...s, track: t }))}
              >
                {MANJU_GENRE_TRACK_LABELS[t]}
              </button>
            ))}
          </div>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={wf.genderHint.acknowledged}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  genderHint: { ...s.genderHint, acknowledged: e.target.checked },
                }))
              }
            />
            <span style={{ fontSize: 12 }}>
              男女频差异已知：{wf.genderHint.female} / {wf.genderHint.male}
            </span>
          </label>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={wf.settingPackLinked}
              onChange={(e) =>
                setWf((s) => ({ ...s, settingPackLinked: e.target.checked }))
              }
            />
            <span style={{ fontSize: 12 }}>已链设定包（SettingWorkbench）</span>
          </label>
        </div>
      )}
      {tab === "track" && (
        <div className="stack" style={{ gap: 8 }}>
          {wf.track === "upgrade" &&
            (
              [
                ["buffStack", "buff 叠满"],
                ["strike", "打击"],
                ["goldFingerOn", "金手指开启"],
                ["revengeMain", "复仇主线"],
                ["growSameTier", "成长期同级无敌"],
                ["developCross", "发展期跨级"],
                ["climax", "高潮"],
              ] as const
            ).map(([k, l]) => (
              <label key={k} className="field">
                <span>{l}</span>
                <input
                  className="input"
                  value={wf.upgrade[k]}
                  onChange={(e) =>
                    setWf((s) => ({
                      ...s,
                      upgrade: { ...s.upgrade, [k]: e.target.value },
                    }))
                  }
                />
              </label>
            ))}
          {wf.track === "anti_trope" && (
            <>
              {(
                [
                  ["characterLayer", "角色层"],
                  ["plotLayer", "剧情层（建议写到这）"],
                  ["worldLayer", "世界观层"],
                ] as const
              ).map(([k, l]) => (
                <label key={k} className="field">
                  <span>{l}</span>
                  <textarea
                    className="textarea"
                    rows={2}
                    value={wf.antiTrope[k]}
                    onChange={(e) =>
                      setWf((s) => ({
                        ...s,
                        antiTrope: { ...s.antiTrope, [k]: e.target.value },
                      }))
                    }
                  />
                </label>
              ))}
              <label className="row" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={wf.antiTrope.writeToPlotLayer}
                  onChange={(e) =>
                    setWf((s) => ({
                      ...s,
                      antiTrope: { ...s.antiTrope, writeToPlotLayer: e.target.checked },
                    }))
                  }
                />
                <span style={{ fontSize: 12 }}>写到剧情层</span>
              </label>
              <label className="row" style={{ gap: 6 }}>
                <input
                  type="checkbox"
                  checked={wf.antiTrope.tropeStockNoted}
                  onChange={(e) =>
                    setWf((s) => ({
                      ...s,
                      antiTrope: { ...s.antiTrope, tropeStockNoted: e.target.checked },
                    }))
                  }
                />
                <span style={{ fontSize: 12 }}>玩梗须先囤梗</span>
              </label>
            </>
          )}
          {wf.track === "regret" &&
            (
              [
                ["passiveWaitRegret", "被动坐等对方后悔"],
                ["payHistoryFull", "付出史写饱"],
                ["openingBuffStack", "开局 buff 叠满"],
                ["contrastWithUpgrade", "与升级流对照"],
              ] as const
            ).map(([k, l]) => (
              <label key={k} className="field">
                <span>{l}</span>
                <textarea
                  className="textarea"
                  rows={2}
                  value={wf.regret[k]}
                  onChange={(e) =>
                    setWf((s) => ({
                      ...s,
                      regret: { ...s.regret, [k]: e.target.value },
                    }))
                  }
                />
              </label>
            ))}
          {!wf.track && <p className="muted">请先在总览选题材轨</p>}
          <div className="field-grid">
            {(
              [
                ["openingEps", "开场集"],
                ["growEps", "成长集"],
                ["developEps", "发展集"],
                ["climaxEps", "高潮集"],
              ] as const
            ).map(([k, l]) => (
              <label key={k} className="field">
                <span>{l}</span>
                <input
                  className="input"
                  type="number"
                  value={wf.quota[k]}
                  onChange={(e) =>
                    setWf((s) => ({
                      ...s,
                      quota: { ...s.quota, [k]: Number(e.target.value) || 0 },
                    }))
                  }
                />
              </label>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 11 }}>
            {wf.quota.note}
          </p>
        </div>
      )}
      {tab === "bench" && (
        <div className="stack" style={{ gap: 8 }}>
          <strong style={{ fontSize: 13 }}>不推荐题材自检</strong>
          {MANJU_DISCOURAGED_TOPICS.map((t) => (
            <label key={t} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={wf.discouraged.avoided.includes(t)}
                onChange={(e) =>
                  setWf((s) => {
                    const avoided = e.target.checked
                      ? [...s.discouraged.avoided, t]
                      : s.discouraged.avoided.filter((x) => x !== t);
                    return {
                      ...s,
                      discouraged: {
                        avoided,
                        allChecked: avoided.length >= MANJU_DISCOURAGED_TOPICS.length,
                      },
                    };
                  })
                }
              />
              <span style={{ fontSize: 12 }}>已避开：{t}</span>
            </label>
          ))}
          <label className="field">
            <span>对标剧名</span>
            <input
              className="input"
              value={wf.benchmark.title}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  benchmark: { ...s.benchmark, title: e.target.value },
                }))
              }
            />
          </label>
          <label className="field">
            <span>收藏数</span>
            <input
              className="input"
              type="number"
              value={wf.benchmark.collectionCount}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  benchmark: {
                    ...s.benchmark,
                    collectionCount: Number(e.target.value) || 0,
                  },
                }))
              }
            />
          </label>
          <Badge tone={bench.ok ? "ok" : "warn"}>{bench.message}</Badge>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={wf.benchmark.deepDissectOk}
              disabled={wf.benchmark.collectionCount < wf.benchmark.threshold}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  benchmark: { ...s.benchmark, deepDissectOk: e.target.checked },
                }))
              }
            />
            <span style={{ fontSize: 12 }}>确认可深拆（须≥{wf.benchmark.threshold}）</span>
          </label>
        </div>
      )}
      {tab === "kernel" && (
        <div className="stack" style={{ gap: 8 }}>
          <p className="muted" style={{ fontSize: 11, margin: 0 }}>
            先人手填五要素再对照 AI（去魅：找对标非抽卡）
          </p>
          {(
            [
              ["who", "人"],
              ["world", "世界"],
              ["power", "能力"],
              ["conflict", "冲突"],
              ["reward", "收获"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="field">
              <span>{l}</span>
              <input
                className="input"
                value={wf.kernel.humanFive[k]}
                onChange={(e) =>
                  setWf((s) => ({
                    ...s,
                    kernel: {
                      ...s.kernel,
                      humanFive: { ...s.kernel.humanFive, [k]: e.target.value },
                    },
                  }))
                }
              />
            </label>
          ))}
          <label className="field">
            <span>AI 五要素摘要</span>
            <textarea
              className="textarea"
              rows={2}
              value={wf.kernel.aiFiveBrief}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  kernel: { ...s.kernel, aiFiveBrief: e.target.value },
                }))
              }
            />
          </label>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={wf.kernel.compared}
              onChange={(e) =>
                setWf((s) => ({
                  ...s,
                  kernel: { ...s.kernel, compared: e.target.checked },
                }))
              }
            />
            <span style={{ fontSize: 12 }}>已对照</span>
          </label>
        </div>
      )}
      {tab === "setting" && (
        <div className="stack" style={{ gap: 8 }}>
          <Badge>复用 DeepMethod 设定包 · 属 12 课入口</Badge>
          <SettingWorkbench projectId={projectId} />
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={wf.settingPackLinked}
              onChange={(e) =>
                setWf((s) => ({ ...s, settingPackLinked: e.target.checked }))
              }
            />
            <span style={{ fontSize: 12 }}>本课闸：设定包已完成并链接</span>
          </label>
        </div>
      )}
    </Panel>
  );
}
