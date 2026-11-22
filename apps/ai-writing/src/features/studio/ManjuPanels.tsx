import { hookReviewSelection } from "./hookReviewSelection";
import {
  type Artifact,
  type EpisodeOutlineBody,
  type GateCheck,
} from "@xiezuomanju/domain";
import {
  canStrongAdopt,
  checkCoreHookAdoption,
  checkLengthDecay,
  manuscriptLength,
  HOOK_BATCH_COUNTS,
  MANJU_KARTIAN_TYPE_NAMES,
  ManjuPipelineWorkflowSchema,
  validateEpisodeOutlineHandbookRow,
  validateEp10HandbookAccept,
  type HookBatchCount,
} from "@xiezuomanju/domain";
import {
  Badge,
  Button,
  CandidateTable,
  DiffCompare,
  GateBadgeList,
  MarkdownDocument,
  Panel,
  StreamPanel,
  TokenChip,
} from "@xiezuomanju/ui";
import { Select } from "@xiezuomanju/ui";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { coreHookRows, selectedCoreHooks } from "../../lib/coreHookChoices";
import { DeAiWorkbench } from "./DeAiWorkbench";
import { CoolPointWorkbench, DialogueTripleWorkbench } from "./DeepMethodPanels";
import { ManjuPipelineWorkbench } from "./NinesLesson11Panels";
import { ManjuGenreTrackWorkbench } from "./NinesLesson12Panels";
import { ManjuAdvancedWorkbench } from "./NinesLesson17Panels";
import { PitchPackWorkbench } from "./ManjuPitchPackPanel";
import { StoryContinuityPanel } from "./StoryContinuityPanel";
import { runAgentFeedback } from "./runAgentFeedback";
import { useAgentRun } from "./useAgentRun";
import { usePersistedState } from "./usePersistedState";
import type { ManjuPipelineWorkflow } from "@xiezuomanju/domain";

function loadSetup(projectId?: string) {
  const fallback = { logline: "重生回到高考前夜，用信息差改写命运", benchmark: "某爆款都市漫剧" };
  if (!projectId) return fallback;
  try {
    const raw = localStorage.getItem(`setup:${projectId}`);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as typeof fallback) };
  } catch {
    return fallback;
  }
}

type Props = {
  stage: string;
  artifacts: Artifact[];
  onAdopt: (id: string, mode: "draft" | "strong") => void;
  flashId?: string | null;
  projectId?: string;
  /** 人工闸确认：写入 stageLock ack，可选附带 payload（如 100 字测试文案） */
  onStageAck?: (payload?: { logline?: string }) => Promise<void> | void;
};

export function ManjuStagePanel({
  stage,
  artifacts,
  onAdopt,
  flashId,
  projectId,
  onStageAck,
}: Props) {
  switch (stage) {
    case "S0_SETUP":
      return (
        <div className="stack">
          <ManjuGenreTrackWorkbench projectId={projectId} />
          <SetupPanel projectId={projectId} />
        </div>
      );
    case "S1_HOOK_BATCH":
    case "S2_HOOK_CRITIC":
    case "S2_HOOK_SELECT":
      return (
        <HookPanel
          projectId={projectId}
          artifacts={artifacts}
          onAdopt={onAdopt}
          flashId={flashId}
          selectMode={stage === "S2_HOOK_SELECT"}
        />
      );
    case "S2_LOGLINE_100":
      return (
        <div className="stack">
          <Logline100Panel projectId={projectId} onStageAck={onStageAck} />
          <ManjuPipelineWorkbench projectId={projectId} />
        </div>
      );
    case "S2_COOL_BATCH":
      return (
        <div className="stack">
          <ManjuPipelineWorkbench projectId={projectId} />
          <CoolPointWorkbench projectId={projectId} />
        </div>
      );
    case "S3_BIO":
    case "S3_BIO_ACK":
    case "S4_BIO":
    case "S4_CHAR_BIO":
      return (
        <CharPanel
          projectId={projectId}
          artifacts={artifacts.filter((a) => a.type === "character")}
          ackMode={stage === "S3_BIO_ACK"}
          onStageAck={onStageAck}
        />
      );
    case "S4_EP10_OUTLINE":
    case "S4_OUTLINE_ACK":
    case "S3_EP10_OUTLINE":
      return (
        <div className="stack">
          <ManjuPipelineWorkbench projectId={projectId} />
          <OutlinePanel
            projectId={projectId}
            artifacts={artifacts.filter((a) => a.type === "episode_outline")}
            ackMode={stage === "S4_OUTLINE_ACK"}
            onStageAck={onStageAck}
          />
          <StoryContinuityPanel projectId={projectId} artifacts={artifacts} />
        </div>
      );
    case "S5_EP_BODY_BATCH":
      return (
        <div className="stack">
          <BodyQueuePanel
            projectId={projectId}
            artifacts={artifacts.filter((a) => a.type === "manuscript")}
          />
          <StoryContinuityPanel projectId={projectId} artifacts={artifacts} />
        </div>
      );
    case "S6_QA":
    case "S6_AI_CORRECT":
      return <CorrectPanel projectId={projectId} />;
    case "S7_STORYBOARD":
      return <StoryboardHandbookPanel projectId={projectId} />;
    case "S8_DIALOGUE":
      return (
        <div className="stack">
          <DialogueHarshSidePanel projectId={projectId} />
          <DialogueTripleWorkbench projectId={projectId} artifacts={artifacts} />
        </div>
      );
    case "S9_DE_AI":
    case "S7_DE_AI":
      return <DeAiPanel projectId={projectId} />;
    case "S10_HUMAN_QC":
    case "S8_HUMAN_QC":
      return (
        <div className="stack">
          <StoryContinuityPanel projectId={projectId} artifacts={artifacts} showLogicAlerts />
          <QcPanel projectId={projectId} onStageAck={onStageAck} />
        </div>
      );
    case "S11_EXTEND":
    case "S9_EXTEND":
    case "S9_EXTEND_OUTLINE":
      return (
        <div className="stack">
          <StoryContinuityPanel projectId={projectId} artifacts={artifacts} showLogicAlerts />
          <ManjuAdvancedWorkbench projectId={projectId} />
          <ExtendOutlineFormPanel projectId={projectId} />
        </div>
      );
    case "S11_PITCH":
    case "S10_PITCH":
      return (
        <div className="stack">
          <ManjuPipelineWorkbench projectId={projectId} />
          <PitchPackWorkbench projectId={projectId} />
          <PitchFourPackPanel artifacts={artifacts} projectId={projectId} />
        </div>
      );
    case "S11_DONE":
    case "S10_DONE":
      return (
        <Panel title="项目完成">
          <p>漫剧主流程已走完。可归档或开启新一轮扩展。</p>
        </Panel>
      );
    default:
      return <Panel title={stage}>未识别步骤</Panel>;
  }
}


function SetupPanel({ projectId }: { projectId?: string }) {
  const [form, setForm] = useState(() => loadSetup(projectId));
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setForm(loadSetup(projectId));
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    try {
      localStorage.setItem(`setup:${projectId}`, JSON.stringify(form));
    } catch {
      /* ignore */
    }
  }, [projectId, form]);

  const persist = async () => {
    if (!projectId) {
      setMsg("已写入本地（无 projectId）");
      return;
    }
    try {
      await api.patchProject(projectId, {
        coverMeta: { logline: form.logline.trim(), benchmark: form.benchmark.trim() },
      });
      setMsg("已同步 coverMeta");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Panel title="S0 项目设置">
      <div className="stack">
        <p className="muted">确认频向、题材删减、市场和写作指令。完成后进入核心梗批量。</p>
        <label className="stack">
          <span>一句话卖点</span>
          <input
            className="input"
            value={form.logline}
            onChange={(e) => setForm((f) => ({ ...f, logline: e.target.value }))}
          />
        </label>
        <label className="stack">
          <span>对标</span>
          <input
            className="input"
            value={form.benchmark}
            onChange={(e) => setForm((f) => ({ ...f, benchmark: e.target.value }))}
          />
        </label>
        <div className="row">
          <TokenChip estimate={0} used={0} />
          <Button variant="primary" onClick={() => void persist()}>
            保存设置
          </Button>
          {msg ? <Badge tone="ok">{msg}</Badge> : <Badge tone="ok">设置可完成</Badge>}
        </div>
      </div>
    </Panel>
  );
}

const FOUR_STEP_DEFAULT = {
  world: "",
  identityGap: "",
  goldFinger: "",
  coreAction: "",
};

function FourStepCombo({
  projectId,
  onSeed,
  count,
}: {
  projectId?: string;
  onSeed: (seed: string) => void;
  count: HookBatchCount;
}) {
  const [steps, setSteps] = useState(FOUR_STEP_DEFAULT);
  const ready =
    steps.world.trim() &&
    steps.identityGap.trim() &&
    steps.goldFinger.trim() &&
    steps.coreAction.trim();

  const seedText = [
    `世界观：${steps.world.trim()}`,
    `身份反差：${steps.identityGap.trim()}`,
    `限制金手指：${steps.goldFinger.trim()}`,
    `核心动作/追剧点：${steps.coreAction.trim()}`,
  ].join("\n");

  return (
    <Panel title="核心梗四步组合法（17 课）">
      <p className="muted" style={{ marginTop: 0 }}>
        世界观 → 身份反差 → 限制型金手指 → 核心动作/追剧点。四步齐全再批量扩写。
      </p>
      <div className="field-grid">
        {(
          [
            ["world", "1. 世界观", "例：灵气复苏的下沉都市"],
            ["identityGap", "2. 身份反差", "例：本该是废柴，实为幕后掌局"],
            ["goldFinger", "3. 限制金手指", "例：每日一次预知，代价是失忆一小时"],
            ["coreAction", "4. 核心动作/追剧点", "例：用信息差逐层打脸债主联盟"],
          ] as const
        ).map(([key, label, ph]) => (
          <label key={key} className="field" style={{ gridColumn: "1 / -1" }}>
            <span>{label}</span>
            <input
              className="input"
              value={steps[key]}
              placeholder={ph}
              onChange={(e) => setSteps((s) => ({ ...s, [key]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      <div className="row" style={{ marginTop: 8, flexWrap: "wrap", gap: 8 }}>
        <Badge tone={ready ? "ok" : "warn"}>{ready ? "四步齐全" : "四步未齐"}</Badge>
        <Button
          variant="primary"
          disabled={!ready || !projectId}
          onClick={() => {
            onSeed(seedText);
            void runAgentFeedback(projectId!, "topic.core_hook_batch", {
              label: "topic.core_hook_batch",
              inputJson: { seed: seedText, fourStep: steps, count },
            });
          }}
        >
          用四步种子批量生成（{count}）
        </Button>
      </div>
    </Panel>
  );
}

function HookPanel({
  projectId,
  artifacts,
  onAdopt,
  flashId,
  selectMode,
}: {
  projectId?: string;
  artifacts: Artifact[];
  onAdopt: (id: string, mode: "draft" | "strong") => void;
  flashId?: string | null;
  selectMode: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reviewGender, setReviewGender] = useState("");
  const [favOnly, setFavOnly] = useState(false);
  const [gates, setGates] = useState<GateCheck[]>([]);
  const [fourSeed, setFourSeed] = useState("");
  const [batchCount, setBatchCount] = usePersistedState<HookBatchCount>(
    projectId,
    "hook-batch-count",
    10,
  );
  const [page, setPage] = useState(0);
  const pageSize = 20;
  const stream = useAgentRun(projectId, "topic.core_hook_batch");
  const qc = useQueryClient();

  const rows = useMemo(() => coreHookRows(artifacts), [artifacts]);
  const { selectedRows, selectedIds: activeSelectedIds } = selectedCoreHooks(rows, selected);
  const hasActiveSelection = activeSelectedIds.length > 0;
  const [draftId] = activeSelectedIds;

  const { requiresSelection, reviewRows, reviewRangeValid } = hookReviewSelection(rows, selected);

  const tryAdopt = async (id: string, mode: "draft" | "strong") => {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const checks = checkCoreHookAdoption(row.body, mode);
    setGates(checks);
    if (mode === "strong" && !canStrongAdopt(checks)) return;
    if (row.itemIndex != null) {
      // 批量候选：先落一条单梗 artifact，再采纳（强采纳门禁按单梗执行）。
      if (!projectId) return;
      const created = await api.createArtifact(projectId, {
        type: "core_hook",
        title: row.body.titleHook || "核心梗候选",
        bodyJson: row.body as unknown as Record<string, unknown>,
        status: "candidate",
      });
      onAdopt(created.id, mode);
      return;
    }
    onAdopt(id, mode);
  };

  const toggleFav = async (id: string) => {
    if (!projectId) return;
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    try {
      if (row.itemIndex != null) {
        const nextBody = { ...(row.artifact.bodyJson ?? {}) } as {
          items?: Array<{ favorited?: boolean }>;
        };
        if (Array.isArray(nextBody.items) && nextBody.items[row.itemIndex]) {
          nextBody.items[row.itemIndex] = {
            ...nextBody.items[row.itemIndex],
            favorited: !row.body.favorited,
          };
          await api.updateArtifact(projectId, row.artifact.id, {
            bodyJson: nextBody as unknown as Record<string, unknown>,
          });
        }
      } else {
        await api.updateArtifact(projectId, id, {
          bodyJson: { ...row.body, favorited: !row.body.favorited },
        });
      }
      qc.invalidateQueries({ queryKey: ["artifacts", projectId] });
    } catch {
      /* ignore */
    }
  };

  const discardSelected = async () => {
    if (!projectId || !hasActiveSelection) return;
    const byArtifact = new Map<string, Set<number>>();
    for (const id of activeSelectedIds) {
      const row = rows.find((r) => r.id === id);
      if (!row) continue;
      if (row.itemIndex != null) {
        const set = byArtifact.get(row.artifact.id) ?? new Set<number>();
        set.add(row.itemIndex);
        byArtifact.set(row.artifact.id, set);
      } else {
        await api.deleteArtifact(projectId, id).catch(() => {});
      }
    }
    for (const [artifactId, indexes] of byArtifact) {
      const art = artifacts.find((a) => a.id === artifactId);
      if (!art) continue;
      const nextItems = (
        (art.bodyJson as { items?: unknown[] } | undefined)?.items ?? []
      ).filter((_, i) => !indexes.has(i));
      await api
        .updateArtifact(projectId, artifactId, {
          bodyJson: { ...(art.bodyJson ?? {}), items: nextItems },
        })
        .catch(() => {});
    }
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ["artifacts", projectId] });
  };

  const filteredRows = favOnly ? rows.filter((r) => r.body.favorited) : rows;
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const visibleRows = filteredRows.slice(page * pageSize, page * pageSize + pageSize);

  return (
    <div className="stack">
      {!selectMode && (
        <FourStepCombo projectId={projectId} onSeed={setFourSeed} count={batchCount} />
      )}
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <strong>{selectMode ? "核心梗筛选采纳" : "核心梗批量生成"}</strong>
          <div className="muted">
            可选 10/50/100 · 分页筛选 · 强采纳须动机+开篇+标签+危机
            {fourSeed ? " · 已带四步种子" : ""}
          </div>
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          <label className="field" style={{ margin: 0 }}>
            <span style={{ fontSize: 11 }}>条数</span>
            <Select
              className="select"
              value={batchCount}
              onChange={(e) => setBatchCount(Number(e.target.value) as HookBatchCount)}
            >
              {HOOK_BATCH_COUNTS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </label>
          <TokenChip estimate={12000} used={12840} />
          <Button
            variant="ghost"
            disabled={!hasActiveSelection || stream.streaming}
            onClick={() => {
              if (!hasActiveSelection) return;
              void stream.start({
                inputJson: {
                  seed: selectedRows
                    .map((r) => r.body.coreHook || r.body.titleHook)
                    .join("\n"),
                  count: batchCount,
                },
              });
            }}
          >
            基于选中再来 {batchCount} 条
          </Button>
          <Button
            variant="primary"
            disabled={!projectId || stream.streaming}
            onClick={() =>
              void stream.start({
                inputJson: { seed: fourSeed || undefined, count: batchCount },
              })
            }
          >
            再生成 {batchCount} 条
          </Button>
          <label>
            评审频别
            <Select className="select" value={reviewGender} onChange={e => setReviewGender(e.target.value)}>
              <option value="">请选择</option>
              <option value="male">男频</option>
              <option value="female">女频</option>
            </Select>
          </label>
          {requiresSelection && <span>请勾选 1–100 条进行评审，当前已选 {reviewRows.length} 条。</span>}
          <Button
            variant="ghost"
            size="sm"
            disabled={!projectId || !reviewGender || !reviewRangeValid}
            onClick={() =>
              projectId &&
              void runAgentFeedback(projectId, "topic.core_hook_critic", {
                label: "topic.core_hook_critic",
                inputJson: { gender_path: reviewGender, artifactIds: reviewRows.map((r) => r.id), artifactVersions:Object.fromEntries(reviewRows.map(r=>[r.artifact.id,r.artifact.version])) },
              }).then(()=>qc.invalidateQueries({queryKey:["artifacts",projectId]}))
            }
          >
            评审打分
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!projectId}
            onClick={() =>
              projectId &&
              void runAgentFeedback(projectId, "topic.hotspot", {
                label: "topic.hotspot",
                inputJson: { hotspot: fourSeed || "当前编辑向热点", format: "manju" },
              })
            }
          >
            热点选题卡
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setFavOnly((v) => !v)}>
            {favOnly ? "显示全部" : "只看收藏"}
          </Button>
        </div>
      </div>
      {stream.error && <Badge tone="fail">{stream.error}</Badge>}
      <GateBadgeList checks={gates} />
      <StreamPanel
        text={stream.text}
        streaming={stream.streaming}
        onAbort={stream.abort}
        onStart={() => void stream.start()}
      />
      <CandidateTable
        rows={visibleRows}
        selectedIds={selected}
        flashId={flashId}
        onToggle={(id) => {
          setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          });
        }}
        columns={[
          {
            key: "title",
            header: "标题钩",
            render: (r) => r.body.titleHook || r.artifact.title,
          },
          {
            key: "tags",
            header: "标签",
            width: 100,
            render: (r) =>
              r.body.tags?.length ? (
                r.body.tags.slice(0, 3).join("·")
              ) : (
                <span className="badge badge-warn">缺</span>
              ),
          },
          {
            key: "motivation",
            header: "动机",
            width: 100,
            render: (r) => r.body.motivation || <span className="badge badge-warn">缺</span>,
          },
          {
            key: "crisis",
            header: "危机",
            width: 100,
            render: (r) => r.body.crisis || <span className="badge badge-warn">缺</span>,
          },
          {
            key: "opening",
            header: "开篇",
            width: 120,
            render: (r) => r.body.openingStructure || <span className="badge badge-warn">缺</span>,
          },
          {
            key: "scores",
            header: "评分",
            width: 140,
            render: (r) => {
              const v = r.body.criticReview;
              const s = r.body.scores;
              if (v) return <div>第{v.rank}名 · {v.total}/25 · {v.recommendation}<br/>市场{v.marketFit} 微创新{v.innovation} 动机{v.motivation} 开篇{v.opening} 合规{v.compliance}<br/>{v.reason}{s && <div>代{s.empathy} 爽{s.thrill} 异{s.diff}</div>}</div>;
              if (!s) return "—";
              return `代${s.empathy ?? "-"} 爽${s.thrill ?? "-"} 异${s.diff ?? "-"}`;
            },
          },
          {
            key: "fav",
            header: "收藏",
            width: 56,
            render: (r) => (
              <button
                type="button"
                className="badge"
                style={{ cursor: "pointer" }}
                title={r.body.favorited ? "取消收藏" : "收藏"}
                onClick={() => void toggleFav(r.id)}
              >
                {r.body.favorited ? "★" : "☆"}
              </button>
            ),
          },
        ]}
        onAdopt={(id) => tryAdopt(id, "strong")}
      />
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <Button size="sm" disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
          上一页
        </Button>
        <Badge>
          {page + 1}/{pageCount} · 共 {filteredRows.length}
        </Badge>
        <Button
          size="sm"
          disabled={page + 1 >= pageCount}
          onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
        >
          下一页
        </Button>
      </div>
      <div className="row">
        <Button variant="danger" disabled={!hasActiveSelection} onClick={() => void discardSelected()}>
          淘汰选中
        </Button>
        <Button
          disabled={!hasActiveSelection}
          onClick={() => {
            if (draftId) void tryAdopt(draftId, "draft");
          }}
        >
          草稿采纳
        </Button>
        <span className="muted">强采纳：动机+开篇+标签+危机；红线仅警告</span>
      </div>
    </div>
  );
}

function Logline100Panel({
  projectId,
  onStageAck,
}: {
  projectId?: string;
  onStageAck?: Props["onStageAck"];
}) {
  const storageKey = projectId ? `logline100:${projectId}` : null;
  const [text, setText] = useState(() => {
    if (!storageKey) return "";
    try {
      return localStorage.getItem(storageKey) || "";
    } catch {
      return "";
    }
  });
  const [busy, setBusy] = useState(false);
  const tooLong = text.trim().length > 120;
  const empty = !text.trim();

  const persist = (v: string) => {
    setText(v);
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, v);
      } catch {
        /* ignore */
      }
    }
  };

  return (
    <Panel title="100 字测试（人工闸）">
      <p className="muted">
        用约 100 字讲给目标受众听；打动不了就弃梗。须人写/人改，禁止 AI 直出简介冒充终稿。
      </p>
      <textarea
        className="input"
        rows={4}
        value={text}
        onChange={(e) => persist(e.target.value)}
        placeholder="约 100 字：身份反差 + 冲突 + 追剧点…"
        style={{ width: "100%" }}
      />
      <div className="row" style={{ marginTop: 8, flexWrap: "wrap", gap: 8 }}>
        <Badge tone={empty ? "fail" : tooLong ? "warn" : "ok"}>
          {text.trim().length} 字{tooLong ? " · 偏长" : ""}
        </Badge>
        <Button
          variant="primary"
          disabled={empty || busy || !onStageAck}
          onClick={() => {
            void (async () => {
              setBusy(true);
              try {
                await onStageAck?.({ logline: text.trim() });
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          确认这段文案，进入下一步
        </Button>
      </div>
      <p className="muted" style={{ marginTop: 8 }}>
        确认后会记住这一步；没有确认就不能进入人物设定和大纲。
        {!projectId ? "（缺少 projectId）" : ""}
      </p>
    </Panel>
  );
}

function syncOutlineAcceptToPipeline(
  projectId: string | undefined,
  episodeNo: number,
  accepted: boolean,
) {
  if (!projectId) return;
  try {
    const key = `deep:${projectId}:manju-pipeline-wf`;
    const raw = localStorage.getItem(key);
    const base = raw
      ? ManjuPipelineWorkflowSchema.parse(JSON.parse(raw))
      : ManjuPipelineWorkflowSchema.parse({});
    const outlinePerEpReview = base.outlinePerEpReview.map((r) =>
      r.ep === episodeNo
        ? { ...r, coolOk: accepted, crisisOk: accepted, done: accepted }
        : r,
    );
    const ep10TableAccept = [
      ...(base.handbookOps?.ep10TableAccept ?? []),
    ];
    localStorage.setItem(
      key,
      JSON.stringify({
        ...base,
        outlinePerEpReview,
        handbookOps: { ...base.handbookOps, ep10TableAccept },
      }),
    );
  } catch {
    /* ignore */
  }
}

function OutlinePanel({
  projectId,
  artifacts,
  ackMode,
  onStageAck,
}: {
  projectId?: string;
  artifacts: Artifact[];
  ackMode?: boolean;
  onStageAck?: Props["onStageAck"];
}) {
  const qc = useQueryClient();
  const sorted = [...artifacts].sort(
    (a, b) =>
      Number((a.bodyJson as { episodeNo?: number })?.episodeNo ?? 0) -
      Number((b.bodyJson as { episodeNo?: number })?.episodeNo ?? 0),
  );
  const bodies = sorted.map((a) => a.bodyJson as EpisodeOutlineBody);
  const adoptedHook = artifacts.find(
    (a) => a.type === "core_hook" && a.status === "adopted",
  );
  const hookText =
    (adoptedHook?.bodyJson as { coreHook?: string } | undefined)?.coreHook ||
    adoptedHook?.bodyMarkdown ||
    "";
  const handbookGate = validateEp10HandbookAccept(
    bodies.filter((b) => b.episodeNo >= 1 && b.episodeNo <= 10),
  );

  const setVerdict = async (
    artifactId: string,
    body: EpisodeOutlineBody,
    verdict: "pending" | "reject" | "accept",
  ) => {
    if (!projectId) return;
    try {
      await api.updateArtifact(projectId, artifactId, {
        bodyJson: { ...body, humanVerdict: verdict },
      });
      syncOutlineAcceptToPipeline(projectId, body.episodeNo, verdict === "accept");
      qc.invalidateQueries({ queryKey: ["artifacts", projectId] });
    } catch {
      /* ignore */
    }
  };

  return (
    <Panel
      title={ackMode ? "大纲人工确认（手册能不能用）" : "前十集大纲 · 爽点|卡点"}
      actions={
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <TokenChip estimate={8000} used={3900} />
          <Badge tone={handbookGate.ok ? "ok" : "warn"}>{handbookGate.message}</Badge>
          {!ackMode && (
            <>
              <Button
                disabled={!projectId}
                onClick={() =>
                  projectId &&
                  void runAgentFeedback(projectId, "struct.episode_outline", {
                    label: "struct.episode_outline",
                    inputJson: { hook: hookText },
                  })
                }
              >
                生成大纲
              </Button>
              <Button
                size="sm"
                disabled={!projectId}
                onClick={() =>
                  projectId &&
                  void runAgentFeedback(projectId, "struct.kartian", {
                    label: "struct.kartian",
                  })
                }
              >
                卡点库
              </Button>
              <Button
                size="sm"
                disabled={!projectId || sorted.length === 0}
                onClick={() =>
                  projectId &&
                  void runAgentFeedback(projectId, "hook.episode_alts", {
                    label: "hook.episode_alts",
                    inputJson: {
                      alts_per_ep: 3,
                      episodes: sorted.map((a) => {
                        const b = a.bodyJson as EpisodeOutlineBody;
                        return {
                          ep: b.episodeNo,
                          summary: b.summary || b.title,
                          currentHook: b.hookAtEnd ? b.cliffText || "已有钩" : "",
                        };
                      }),
                    },
                  })
                }
              >
                集尾钩多备选
              </Button>
            </>
          )}
        </div>
      }
    >
      {ackMode && (
        <div className="stack" style={{ gap: 8, marginBottom: 8 }}>
          <p className="muted">
            手册：表格转文字后须核对。逐集标「可以用/不能用」；建议前十全 accept 再过闸。正文改则同步改大纲。
          </p>
          <Button
            variant="primary"
            disabled={!onStageAck || artifacts.length < 1}
            onClick={() => void onStageAck?.()}
          >
            确认大纲可用并过闸
          </Button>
        </div>
      )}
      <CoolPointWorkbench projectId={projectId} />
      <table className="table">
        <thead>
          <tr>
            <th>集</th>
            <th>分集内容</th>
            <th>爽点</th>
            <th>卡点</th>
            <th>付费点</th>
            <th>情绪峰</th>
            <th>钩子</th>
            <th>能不能用</th>
            <th>行检</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((a) => {
            const b = a.bodyJson as EpisodeOutlineBody;
            const rowG = validateEpisodeOutlineHandbookRow(b);
            const coolLabel =
              b.coolModels?.length > 0
                ? b.coolModels.join("·")
                : b.coolPoint || "—";
            const cliffLabel = [b.cliffType, b.cliffText].filter(Boolean).join("：") || "—";
            return (
              <tr key={a.id}>
                <td>{b.episodeNo}</td>
                <td>
                  <strong style={{ fontSize: 12 }}>{b.title}</strong>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {b.summary}
                  </div>
                </td>
                <td style={{ fontSize: 12 }}>{coolLabel}</td>
                <td style={{ fontSize: 12 }}>
                  {cliffLabel}
                  {b.cliffType &&
                  !(MANJU_KARTIAN_TYPE_NAMES as readonly string[]).includes(b.cliffType) ? (
                    <Badge tone="warn">类型未对齐</Badge>
                  ) : null}
                </td>
                <td style={{ fontSize: 12 }}>
                  {b.paywallPoint || b.paywallHint || (
                    <span className="muted">未标</span>
                  )}
                </td>
                <td>
                  {typeof b.emotionPeak === "number" ? (
                    <Badge
                      tone={b.emotionPeak >= 6 ? "ok" : b.emotionPeak <= -3 ? "fail" : "warn"}
                    >
                      {b.emotionPeak}
                    </Badge>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  <Badge tone={b.hookAtEnd ? "ok" : "warn"}>
                    {b.hookAtEnd ? "有" : "无"}
                  </Badge>
                </td>
                <td>
                  <Select
                    className="select"
                    value={b.humanVerdict ?? "pending"}
                    disabled={!projectId}
                    onChange={(e) =>
                      void setVerdict(
                        a.id,
                        b,
                        e.target.value as "pending" | "reject" | "accept",
                      )
                    }
                  >
                    <option value="pending">待定</option>
                    <option value="reject">不能用</option>
                    <option value="accept">可以用</option>
                  </Select>
                </td>
                <td>
                  <Badge tone={rowG.ok ? "ok" : "warn"}>{rowG.ok ? "齐" : "缺"}</Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted" style={{ marginTop: 8 }}>
        集尾钩子、节奏安排、爽点和卡点分类供参考。每集能否使用由作者确认。
      </p>
    </Panel>
  );
}

function CharPanel({
  projectId,
  artifacts,
  ackMode,
  onStageAck,
}: {
  projectId?: string;
  artifacts: Artifact[];
  ackMode?: boolean;
  onStageAck?: Props["onStageAck"];
}) {
  const adoptedHook = artifacts.find(
    (a) => a.type === "core_hook" && a.status === "adopted",
  );
  const hookText =
    (adoptedHook?.bodyJson as { coreHook?: string } | undefined)?.coreHook ||
    adoptedHook?.bodyMarkdown ||
    "";
  return (
    <Panel title={ackMode ? "小传人工确认" : "人设小传（大纲前）"}>
      {ackMode && (
        <div className="stack" style={{ gap: 8, marginBottom: 8 }}>
          <p className="muted">考拉流：小传须在十集大纲前确认并写入 bible。确认后再生成大纲。</p>
          <Button
            variant="primary"
            disabled={!onStageAck || artifacts.length < 1}
            onClick={() => void onStageAck?.()}
          >
            确认小传并过闸
          </Button>
        </div>
      )}
      {artifacts.map((a) => (
        <div key={a.id} className="stack" style={{ marginBottom: 12 }}>
          <strong>{a.title}</strong>
          <MarkdownDocument source={a.bodyMarkdown ?? ""} />
        </div>
      ))}
      {!artifacts.length && <div className="muted">暂无人设，可生成候选。</div>}
      {!ackMode && (
        <Button
          disabled={!projectId}
          onClick={() =>
            projectId &&
            void runAgentFeedback(projectId, "char.bio_manju", {
              label: "char.bio_manju",
              inputJson: { hook: hookText },
            })
          }
        >
          生成人设候选（Job）
        </Button>
      )}
    </Panel>
  );
}

function BodyQueuePanel({
  projectId,
  artifacts,
}: {
  projectId?: string;
  artifacts: Artifact[];
}) {
  const sorted = [...artifacts].sort(
    (a, b) =>
      Number((a.bodyJson as { episodeNo?: number })?.episodeNo ?? 0) -
      Number((b.bodyJson as { episodeNo?: number })?.episodeNo ?? 0),
  );
  const lengths = sorted.map(manuscriptLength);
  const checks = lengths.map((currentChars, i) => checkLengthDecay({
    currentChars,
    prevChars: lengths[i - 1],
  }));
  const decayFails = checks.flatMap((check, i) => check.result === "fail"
    ? [`第${sorted[i]?.bodyJson?.episodeNo ?? i + 1}集：${check.message}`]
    : []);
  const hardStop = decayFails.length > 0;

  return (
    <Panel
      title="分集正文队列（默认前 3 集）"
      actions={<TokenChip estimate={30000} used={0} />}
    >
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        手册规格：全文 800–1200 · 场景 ≤3 · 台词含旁白 ≤500 · 集尾兑现卡点。
      </p>
      {hardStop && (
        <Badge tone="fail">
          正文低于最低字数：{decayFails.join("；")}。禁止续写下一批，请先校正。
        </Badge>
      )}
      <table className="table">
        <thead>
          <tr>
            <th>集</th>
            <th>字数</th>
            <th>规格</th>
            <th>衰减</th>
            <th>队列状态</th>
            <th>钩子</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((a, i) => {
            const b = (a.bodyJson ?? {}) as {
              episodeNo?: number;
              queueStatus?: string;
              hookAtEnd?: boolean;
            };
            const cur = lengths[i]!;
            const decay = checks[i]!;
            const bandOk = cur >= 800 && cur <= 1200;
            return (
              <tr key={a.id}>
                <td>第{b.episodeNo ?? i + 1}集</td>
                <td>{cur}</td>
                <td>
                  <Badge tone={bandOk ? "ok" : "warn"}>
                    {bandOk ? "800–1200" : cur < 800 ? "偏短" : "偏长"}
                  </Badge>
                </td>
                <td>
                  <Badge tone={decay.result === "pass" ? "ok" : decay.result === "fail" ? "fail" : "warn"}>
                    {decay.result === "pass" ? "OK" : decay.message}
                  </Badge>
                </td>
                <td>
                  <Badge
                    tone={
                      b.queueStatus === "adopted"
                        ? "ok"
                        : b.queueStatus === "failed"
                          ? "fail"
                          : "default"
                    }
                  >
                    {b.queueStatus || "draft"}
                  </Badge>
                </td>
                <td>{b.hookAtEnd ? "有" : "无"}</td>
                <td>
                  <Button>查看</Button>
                </td>
              </tr>
            );
          })}
          {Array.from({ length: Math.max(0, 3 - sorted.length) }, (_, i) => (
            <tr key={`pending-${i}`}>
              <td>第{sorted.length + i + 1}集</td>
              <td>—</td>
              <td>—</td>
              <td>
                <Badge>pending</Badge>
              </td>
              <td>—</td>
              <td>
                <Button disabled>等待</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: 8 }}>
        <Button
          variant="primary"
          disabled={!projectId || hardStop}
          onClick={() => {
            if (!projectId || hardStop) return;
            void (async () => {
              await runAgentFeedback(projectId, "qc.bible_guard", { label: "qc.bible_guard" });
              await runAgentFeedback(projectId, "orch.batch_writer", { label: "orch.batch_writer" });
            })();
          }}
        >
          注入 Bible 并串行前 3 集
        </Button>
        <Button
          disabled={!projectId || !hardStop}
          onClick={() => projectId && void runAgentFeedback(projectId, "prose.length_decay_fix", { label: "prose.length_decay_fix" })}
        >
          一键衰减校正
        </Button>
        <span className="muted">低于最低字数时暂停；满 3 集进规格校正</span>
      </div>
    </Panel>
  );
}

function CorrectPanel({ projectId }: { projectId?: string }) {
  return (
    <div className="stack">
      <DiffCompare
        leftTitle="AI 初稿"
        rightTitle="校正建议"
        left={<pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>【分镜】教室…台词偏说明腔 / 或字数过短。</pre>}
        right={
          <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
            建议：补可拍情节至 800–1200；≤3 场；台词≤500；删下集预告加戏。
          </pre>
        }
      />
      <div className="row">
        <Button
          variant="primary"
          disabled={!projectId}
          onClick={() => projectId && void runAgentFeedback(projectId, "prose.qa_correct", { label: "prose.qa_correct" })}
        >
          规格校正
        </Button>
        <Button
          disabled={!projectId}
          onClick={() => projectId && void runAgentFeedback(projectId, "prose.length_decay_fix", { label: "prose.length_decay_fix" })}
        >
          字数衰减修复
        </Button>
      </div>
    </div>
  );
}

function PitchFourPackPanel({
  artifacts,
  projectId,
}: {
  artifacts: Artifact[];
  projectId?: string;
}) {
  const hooks = artifacts.filter((a) => a.type === "core_hook" && a.status === "adopted").length;
  const bios = artifacts.filter((a) => a.type === "character").length;
  const outlines = artifacts.filter((a) => a.type === "episode_outline").length;
  const bodies = artifacts.filter((a) => a.type === "manuscript").length;
  const missing: string[] = [];
  if (hooks < 1) missing.push("核心梗");
  if (bios < 1) missing.push("人物小传");
  if (outlines < 10) missing.push(`前十集大纲(${outlines}/10)`);
  if (bodies < 3) missing.push(`前三集正文(${bodies}/3)`);
  const ok = missing.length === 0;
  return (
    <Panel title="投稿打包（四件套）">
      <Badge tone={ok ? "ok" : "fail"}>{ok ? "四件套齐全" : `缺：${missing.join("、")}`}</Badge>
      <p className="muted">缺一不可进 Pitch。编辑审稿：梗概→人设→大纲→正文。</p>
      <Button
        variant="primary"
        disabled={!projectId || !ok}
        onClick={() => projectId && void runAgentFeedback(projectId, "deliver.pitch_pack", { label: "deliver.pitch_pack" })}
      >
        生成投稿包
      </Button>
    </Panel>
  );
}

function useManjuPipelineLocal(projectId?: string) {
  return usePersistedState<ManjuPipelineWorkflow>(
    projectId,
    "manju-pipeline-wf",
    ManjuPipelineWorkflowSchema.parse({}),
  );
}

function ExtendOutlineFormPanel({ projectId }: { projectId?: string }) {
  const [wf, setWf] = useManjuPipelineLocal(projectId);
  const f = wf.handbookOps.extendForm;
  return (
    <Panel title="扩展大纲（手册第四节 · 分块）">
      <p className="muted" style={{ fontSize: 12 }}>
        须含核心梗+前十大纲+冲突升级；禁止一次扩全书。对齐 Act100 幕锚可选。
      </p>
      <div className="field-grid">
        <label className="field">
          <span>集起</span>
          <input
            className="input"
            type="number"
            value={f.blockFrom}
            onChange={(e) =>
              setWf((s) => ({
                ...s,
                handbookOps: {
                  ...s.handbookOps,
                  extendForm: {
                    ...s.handbookOps.extendForm,
                    blockFrom: Number(e.target.value) || 11,
                  },
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
            value={f.blockTo}
            onChange={(e) =>
              setWf((s) => ({
                ...s,
                handbookOps: {
                  ...s.handbookOps,
                  extendForm: {
                    ...s.handbookOps.extendForm,
                    blockTo: Number(e.target.value) || 20,
                  },
                },
              }))
            }
          />
        </label>
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          <span>冲突升级备注</span>
          <input
            className="input"
            value={f.conflictUpgrade}
            onChange={(e) =>
              setWf((s) => ({
                ...s,
                handbookOps: {
                  ...s.handbookOps,
                  extendForm: {
                    ...s.handbookOps.extendForm,
                    conflictUpgrade: e.target.value,
                  },
                },
              }))
            }
          />
        </label>
      </div>
      <label className="row" style={{ gap: 6, margin: "8px 0" }}>
        <input
          type="checkbox"
          checked={f.foreshadowSync}
          onChange={(e) =>
            setWf((s) => ({
              ...s,
              handbookOps: {
                ...s.handbookOps,
                extendForm: {
                  ...s.handbookOps.extendForm,
                  foreshadowSync: e.target.checked,
                },
              },
            }))
          }
        />
        <span style={{ fontSize: 12 }}>伏笔已复盘同步</span>
      </label>
      <label className="field">
        <span>能不能用</span>
        <Select
          className="select"
          value={f.humanVerdict}
          onChange={(e) =>
            setWf((s) => ({
              ...s,
              handbookOps: {
                ...s.handbookOps,
                extendForm: {
                  ...s.handbookOps.extendForm,
                  humanVerdict: e.target.value as typeof f.humanVerdict,
                },
              },
            }))
          }
        >
          <option value="pending">待定</option>
          <option value="reject">不能用</option>
          <option value="accept">可以用</option>
        </Select>
      </label>
      <div className="row" style={{ marginTop: 8, gap: 8, flexWrap: "wrap" }}>
        <Button
          disabled={!projectId}
          onClick={() =>
            projectId &&
            void runAgentFeedback(projectId, "hook.foreshadow_ledger", {
              label: "hook.foreshadow_ledger",
            })
          }
        >
          伏笔台账审计
        </Button>
        <Button
          variant="primary"
          disabled={!projectId}
          onClick={() =>
            projectId &&
            void runAgentFeedback(projectId, "struct.extend_outline", {
              label: "struct.extend_outline",
              inputJson: {
                block: `${f.blockFrom}-${f.blockTo}`,
                fromEpisode: f.blockFrom,
                toEpisode: f.blockTo,
                conflictUpgrade: f.conflictUpgrade,
                foreshadowSync: f.foreshadowSync,
              },
            })
          }
        >
          生成扩展大纲（入队）
        </Button>
      </div>
    </Panel>
  );
}

function StoryboardHandbookPanel({ projectId }: { projectId?: string }) {
  const [wf, setWf] = useManjuPipelineLocal(projectId);
  const g = wf.handbookOps.scriptFormatGate;
  return (
    <Panel title="去小说化 / 分镜化（手册第三节）">
      <p className="muted" style={{ fontSize: 12 }}>
        将剧本改为「分镜画面+台词」；不要形容词与小说化描述。情绪用简单台词即可。
      </p>
      {(
        [
          ["deNovelizeAck", "已理解去小说化要求"],
          ["sceneHeaderFormat", "场头格式已对齐"],
          ["scenesMax3", "单集场景≤3"],
        ] as const
      ).map(([k, l]) => (
        <label key={k} className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={g[k]}
            onChange={(e) =>
              setWf((s) => ({
                ...s,
                handbookOps: {
                  ...s.handbookOps,
                  scriptFormatGate: {
                    ...s.handbookOps.scriptFormatGate,
                    [k]: e.target.checked,
                  },
                },
              }))
            }
          />
          <span style={{ fontSize: 12 }}>{l}</span>
        </label>
      ))}
      <Button
        variant="primary"
        disabled={!projectId}
        onClick={() =>
          projectId &&
          void runAgentFeedback(projectId, "prose.storyboard", {
            label: "prose.storyboard",
            inputJson: { scriptFormatGate: g },
          })
        }
      >
        去小说化（入队）
      </Button>
    </Panel>
  );
}

function DialogueHarshSidePanel({ projectId }: { projectId?: string }) {
  const [wf, setWf] = useManjuPipelineLocal(projectId);
  const c = wf.handbookOps.dialogueHarshChecklist;
  return (
    <Panel title="台词要狠（手册 · 旁挂三层公式）">
      <p className="muted" style={{ fontSize: 11, marginTop: 0 }}>
        短、狠、毒；不替换态度+信息+潜台词。勾选后可注入 dialogue_pressure。
      </p>
      {(
        [
          ["shortHarsh", "短促有力"],
          ["barbedHook", "带刺带钩"],
          ["contrastShock", "反差冲击"],
          ["evidenceSlap", "证据甩脸"],
          ["crowdReaction", "围观者反应"],
          ["pacePingPong", "快交锋"],
        ] as const
      ).map(([k, l]) => (
        <label key={k} className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={c[k]}
            onChange={(e) =>
              setWf((s) => ({
                ...s,
                handbookOps: {
                  ...s.handbookOps,
                  dialogueHarshChecklist: {
                    ...s.handbookOps.dialogueHarshChecklist,
                    [k]: e.target.checked,
                  },
                },
              }))
            }
          />
          <span style={{ fontSize: 12 }}>{l}</span>
        </label>
      ))}
      <Button
        size="sm"
        disabled={!projectId}
        onClick={() =>
          projectId &&
          void runAgentFeedback(projectId, "prose.dialogue_pressure", {
            label: "prose.dialogue_pressure",
            inputJson: { harshChecklist: c },
          })
        }
      >
        台词加压（带狠清单）
      </Button>
    </Panel>
  );
}

function DeAiPanel({ projectId }: { projectId?: string }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        16.md：改正文时必须同步改提纲（syncOutlineOnBodyEdit）。去 AI 五维仍用既有台，不另造流水线。
      </p>
      <DeAiWorkbench projectId={projectId} />
    </div>
  );
}

const HAND_EDIT_STEPS: { id: string; label: string }[] = [
  { id: "logic", label: "逻辑：纲↔文同步，无硬伤/金手指矛盾" },
  { id: "graph", label: "连续性图：story_graph 告警已过目，伏笔台账无逾期硬伤" },
  { id: "aiTone", label: "AI 表述：去套话排比与总结腔" },
  { id: "camera", label: "镜头：可拍、可合并冗长画面" },
  { id: "voice", label: "人设语言：口吻不串戏、推动情节" },
  { id: "hook", label: "钩/伏笔：集尾能留人，有埋有收" },
  { id: "duration", label: "画面时长：像 1–2 分钟可播，砍注水" },
  { id: "show", label: "以事见人：少形容词，多动作/反应" },
  { id: "cool", label: "爽点兑现：打脸/反转有代价" },
  { id: "ooc", label: "OOC：灵魂拷问三问已过" },
  { id: "redline", label: "红线/平台规范已过目" },
  { id: "dialogue", label: "台词：态度/信息/潜台词至少两层" },
  { id: "sync", label: "正文改完已回写大纲" },
];

function QcPanel({
  projectId,
  onStageAck,
}: {
  projectId?: string;
  onStageAck?: Props["onStageAck"];
}) {
  const [checks, setChecks] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(HAND_EDIT_STEPS.map((s) => [s.id, false])),
  );
  const passed = HAND_EDIT_STEPS.filter((s) => checks[s.id]).length;
  const mustIds = ["logic", "graph", "hook", "redline", "sync"] as const;
  const mustOk = mustIds.every((id) => checks[id]);

  return (
    <div className="stack">
      <Panel title="手搓修改流（漫剧十二检 · ≠短篇10课手搓12）">
        <p className="muted" style={{ marginTop: 0 }}>
          AI 只出初稿与定位；LogicAck 只能人工确认。已勾 {passed}/{HAND_EDIT_STEPS.length}；
          必勾：逻辑 / 钩子 / 红线 / 回写大纲。
        </p>
        <div className="stack" style={{ gap: 6 }}>
          {HAND_EDIT_STEPS.map((s) => (
            <label key={s.id} className="row" style={{ gap: 8 }}>
              <input
                type="checkbox"
                checked={!!checks[s.id]}
                onChange={(e) => setChecks((c) => ({ ...c, [s.id]: e.target.checked }))}
              />
              <span>{s.label}</span>
            </label>
          ))}
        </div>
        <div className="row" style={{ marginTop: 10, flexWrap: "wrap", gap: 8 }}>
          <Badge tone={mustOk ? "ok" : "warn"}>{mustOk ? "必勾已齐" : "必勾未齐"}</Badge>
          <Button
            disabled={!projectId}
            onClick={() => projectId && void runAgentFeedback(projectId, "char.soul_check", { label: "char.soul_check" })}
          >
            灵魂拷问
          </Button>
          <Button
            disabled={!projectId}
            onClick={() => projectId && void runAgentFeedback(projectId, "qc.human_checklist", { label: "qc.human_checklist" })}
          >
            打开校稿工单
          </Button>
          <Button
            variant="primary"
            disabled={!mustOk || !onStageAck}
            onClick={() => void onStageAck?.()}
          >
            LogicAck 确认过闸
          </Button>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          模型不得自称 LogicAck 已绿。
        </p>
      </Panel>
    </div>
  );
}
