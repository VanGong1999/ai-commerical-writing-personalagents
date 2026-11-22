import { manuscriptAccess, restoreSynopsis } from "./manuscriptAccess";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import type { ProjectFormat } from "@xiezuomanju/domain";
import { checkPromptLock } from "@xiezuomanju/domain";
import { agentLinks, getPrompt } from "@xiezuomanju/prompt-registry";
import {
  AgentTimeline,
  Button,
  CollapsibleSection,
  ConfirmDialog,
  Drawer,
  Panel,
  ProgressBar,
  PromptDrawer,
  StageRail,
  StatusBadge,
  StepStatusIcon,
  Tabs,
  TokenChip,
  toast,
} from "@xiezuomanju/ui";
import { Select } from "@xiezuomanju/ui";
import { PanelRight, PanelRightClose, Rows3 } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { api, formatLabel } from "../../api/client";
import { CreationMap } from "./CreationMap";
import { StudioOnboarding } from "./StudioOnboarding";
import {
  bodyTextOf,
  bodyTypesFor,
  bodyUnitNo,
  CharacterBiblePanel,
  deliverableCompletion,
  deliverablesForFormat,
  type DeliverableId,
  EmotionCurvePanel,
  ForesightPanel,
  ManuscriptStudio,
  OutlineDualView,
  PackagePanel,
  QcGatePanel,
  SettingPanel,
  SynopsisPanel,
} from "./deliverables";
import { AnalyticsPanel } from "../projects/AnalyticsPanel";
import { deadlineInfo } from "../projects/ProjectsPage";
import { TropeSearch, type TropeSearchPick } from "../kb/TropeSearch";
import { KnowledgeQuickSearch } from "./KnowledgeQuickSearch";
import { KbBindPanel } from "./KbBindPanel";
import { KIND_META, type BeatKind } from "./BeatMapPanel";
import { MemoryProjectPanel } from "./MemoryProjectPanel";
import { ManjuStagePanel } from "./ManjuPanels";
import { CowritePanel } from "../cowrite/CowritePanel";
import { AutopilotDrawer } from "./AutopilotDrawer";
import { hydrateDeepFromArtifacts } from "./hydrateDeepFromArtifacts";
import { ProjectReplayPanel } from "./ProjectReplayPanel";
import { FeedbackLoopPanel } from "./FeedbackLoopPanel";
import { RunReceiptPanel } from "./RunReceiptPanel";
import { OntologyPanel } from "./OntologyPanel";
import { runAgentFeedback } from "./runAgentFeedback";
import { canAdvanceStage } from "./stageContentGate";
import {
  isValidFormat,
  labelsFor,
  normalizeProjectStage,
  stageProgressFor,
  stagesFor,
} from "./stageConfig";

/** 格式工作台体积大，按需拆包加载。 */
const FormatDeliverableWorkspace = lazy(() =>
  import("./FormatWorkspaces").then((m) => ({
    default: m.FormatDeliverableWorkspace,
  })),
);

/** 创作台 Prompt 抽屉：按格式绑定默认模板 / Agent（禁止写死漫剧） */
const STUDIO_PROMPT_BY_FORMAT: Record<
  ProjectFormat,
  { promptId: string; agentId: string; runLabel: string }
> = {
  manju: {
    promptId: "manju.hook.batch",
    agentId: "topic.core_hook_batch",
    runLabel: "核心梗批量生成",
  },
  duanju: {
    promptId: "duanju.want_how",
    agentId: "topic.want_how",
    runLabel: "选题三问生成",
  },
  short_novel: {
    promptId: "short.opening",
    agentId: "prose.short_opening",
    runLabel: "短篇开篇生成",
  },
  male_long: {
    promptId: "male.upgrade",
    agentId: "male.upgrade_loop",
    runLabel: "升级循环生成",
  },
  female_long: {
    promptId: "female.pace",
    agentId: "female.pace",
    runLabel: "女频节奏生成",
  },
  ip_adapt: {
    promptId: "ip.select",
    agentId: "ip.select_score",
    runLabel: "IP 选书评分",
  },
};

function progressToCompleted(progress?: Record<string, number>): string[] {
  if (!progress) return [];
  return Object.entries(progress)
    .filter(([, v]) => Number(v) > 0)
    .map(([k]) => k);
}

function completedToProgress(completed: string[], base?: Record<string, number>) {
  const next = { ...(base || {}) };
  for (const id of completed) next[id] = 1;
  return next;
}

export function StudioPage() {
  const { format: formatParam } = useParams({ from: "/studio/$format" });
  const search = useSearch({ from: "/studio/$format" });
  const nav = useNavigate();
  const qc = useQueryClient();

  if (!isValidFormat(formatParam)) {
    return <div className="page">未知格式</div>;
  }
  const format = formatParam as ProjectFormat;

  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ["projects", format],
    queryFn: async () => {
      const byFormat = await api.listProjects({ format });
      if (byFormat.length) return byFormat;
      const all = await api.listProjects();
      return all.filter((p) => p.format === format);
    },
  });

  const requestedProject = search.projectId
    ? projects.find((item) => item.id === search.projectId)
    : undefined;
  const fallbackProjectId =
    !search.projectId && projects.length === 1 ? projects[0]?.id : undefined;
  const projectId = requestedProject?.id ?? fallbackProjectId;
  const advisers = useQuery({queryKey:["knowledge-agents",projectId,requestedProject?.stage],enabled:!!projectId,
    queryFn:()=>api.listAgentCatalog(undefined,projectId)});

  useEffect(() => {
    if (!fallbackProjectId) return;
    nav({
      to: "/studio/$format",
      params: { format },
      search: { projectId: fallbackProjectId },
      replace: true,
    });
  }, [fallbackProjectId, format, nav]);
  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.getProject(projectId!),
    enabled: !!projectId,
  });

  const artifactQuery = useQuery({
    queryKey: ["artifacts", projectId],
    queryFn: () => api.listArtifacts(projectId!),
    enabled: !!projectId,
  });

  const artifacts = artifactQuery.data ?? [];
  const stages = stagesFor(format);
  const labels = labelsFor(format);
  const [mode, setMode] = useState<"deliverable" | "stage" | "episodes" | "ontology">("deliverable");
  const [creationMode, setCreationMode] = useState<"auto" | "semi" | "manual">(() => {
    try {
      const v = localStorage.getItem(`creation-mode:${format}`);
      return v === "auto" || v === "manual" || v === "semi" ? v : "semi";
    } catch {
      return "semi";
    }
  });
  const [deliverable, setDeliverable] = useState<DeliverableId>("package");
  const [activeManuscriptId, setActiveManuscriptId] = useState<string | undefined>();
  const [stage, setStage] = useState(project?.stage ?? stages[0]);
  const [skipTarget, setSkipTarget] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [sideTab, setSideTab] = useState("agent");
  const [promptOpen, setPromptOpen] = useState(false);
  const [sideCollapsed, setSideCollapsed] = useState(false);
  const [sideDrawerOpen, setSideDrawerOpen] = useState(false);
  const [railDrawerOpen, setRailDrawerOpen] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [cowriteOpen, setCowriteOpen] = useState(false);
  const [autopilotOpen, setAutopilotOpen] = useState(false);
  const [lastRunId, setLastRunId] = useState<string | undefined>();
  const [agentLog, setAgentLog] = useState<
    { id: string; title: string; detail?: string; tone?: "idle" | "running" | "ok" | "fail" | "pending" }[]
  >([]);
  const [synopsisEdited, setSynopsisEdited] = useState(false);
  const [synopsis, setSynopsis] = useState("");
  const studioPrompt = STUDIO_PROMPT_BY_FORMAT[format];
  const prompt = getPrompt(studioPrompt.promptId);
  const promptAgentId = agentLinks[studioPrompt.promptId] || studioPrompt.agentId;
  const [editable, setEditable] = useState(prompt?.editableInstruction ?? "");

  useEffect(() => {
    const p = getPrompt(STUDIO_PROMPT_BY_FORMAT[format].promptId);
    setEditable(p?.editableInstruction ?? "");
  }, [format]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`creation-mode:${format}`);
      setCreationMode(saved === "manual" || saved === "auto" ? saved : "semi");
      if (saved === "manual") setMode("episodes");
    } catch { /* storage unavailable */ }
  }, [format]);

  useEffect(() => {
    if (project?.id === projectId && project?.stage) setStage(normalizeProjectStage(format, project.stage));
  }, [projectId, project?.id, project?.stage, format]);

  const editSynopsis = (value: string) => {
    setSynopsisEdited(true);
    setSynopsis(value);
    if (projectId) {
      try { localStorage.setItem(`synopsis:${projectId}`, value); } catch { /* storage unavailable */ }
    }
  };
  const projectLogline = project?.coverMeta?.logline?.trim() ?? "";
  useEffect(() => {
    setSynopsisEdited(false);
    if (!projectId) {
      setSynopsis("");
      return;
    }
    try {
      const saved = localStorage.getItem(`synopsis:${projectId}`);
      setSynopsis(restoreSynopsis(saved, projectLogline));
    } catch {
      setSynopsis(projectLogline);
    }
  }, [projectId, project?.id, projectLogline]);

  // 一句话梗概是否未同步到服务端（本地草稿与 coverMeta.logline 不一致）。
  const synopsisDirty = Boolean(projectId) && synopsis !== projectLogline;
  const saveSynopsis = useCallback(async () => {
    if (!projectId) {
      toast.fail("缺少项目，无法保存梗概");
      return;
    }
    try {
      await api.patchProject(projectId, { coverMeta: { logline: synopsis.trim() } });
      localStorage.setItem(`synopsis:${projectId}`, synopsis);
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      toast.ok("已保存一句话梗概");
    } catch (e) {
      toast.fail(e instanceof Error ? e.message : "保存失败");
    }
  }, [projectId, synopsis, qc]);

  useEffect(() => {
    if (!synopsisDirty || !synopsisEdited) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [synopsisDirty, synopsisEdited]);

  const completedKey = projectId ? `stage-completed:${projectId}` : null;
  const [completedStages, setCompletedStages] = useState<string[]>(() => {
    if (!completedKey) return [];
    try {
      return JSON.parse(localStorage.getItem(completedKey) || "[]");
    } catch {
      return [];
    }
  });
  const [migrationHint, setMigrationHint] = useState<string | null>(null);
  const { data: stageGraph } = useQuery({
    queryKey: ["stage-graph", format],
    queryFn: () => api.getStageGraph(format),
    enabled: Boolean(format),
  });

  const persistCompleted = useCallback(
    (completed: string[]) => {
      setCompletedStages(completed);
      if (completedKey) {
        try {
          localStorage.setItem(completedKey, JSON.stringify(completed));
        } catch {
          /* ignore */
        }
      }
      if (projectId) {
        void api
          .patchProject(projectId, {
            progress: completedToProgress(completed, project?.progress),
          })
          .then(() => {
            qc.invalidateQueries({ queryKey: ["project", projectId] });
          })
          .catch(() => {});
      }
    },
    [completedKey, projectId, project?.progress, qc],
  );

  // 打开项目：progress（服务端）优先，再合并 localStorage
  useEffect(() => {
    if (!projectId || project?.id !== projectId) return;
    let local: string[] = [];
    if (completedKey) {
      try {
        local = JSON.parse(localStorage.getItem(completedKey) || "[]");
      } catch {
        local = [];
      }
    }
    const fromProgress = progressToCompleted(project?.progress);
    const merged = [...new Set([...fromProgress, ...(Array.isArray(local) ? local.filter(s => typeof s === "string") : [])])];
    setCompletedStages(merged);
    setMigrationHint(null);
    const currentStageId = project.stage ?? stages[0];
    let active = true;
    void api.stageLock({format, currentStageId, completed: merged, action: "inspect"}).then(res => {
      if (!active || !res.state) return;
      const migrated = res.state.currentStageId;
      setStage(previous => previous === normalizeProjectStage(format, currentStageId) ? migrated : previous);
      if (res.migrationHint) setMigrationHint(res.migrationHint);
    }).catch(() => {});
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, project?.id]);

  const ackCurrentStage = async (payload?: { logline?: string }) => {
    if (stage === "S2_LOGLINE_100") {
      const logline = (payload?.logline || "").trim();
      if (!logline) {
        toast.fail("请先填写约 100 字测试文案");
        return;
      }
      if (projectId) {
        try {
          localStorage.setItem(`logline100:${projectId}`, logline);
        } catch {
          /* ignore */
        }
      }
    }
    const res = await api.stageLock({
      format,
      currentStageId: stage,
      completed: completedStages,
      action: "ack",
    });
    if (res.migrationHint) setMigrationHint(res.migrationHint);
    if (res.state?.completed) persistCompleted(res.state.completed);
    toast.ok("已确认本步");
  };

  const navigateStage = useCallback(
    async (targetId: string, opts?: { force?: boolean; reason?: string }) => {
      const check = await api.stageLock({
        format,
        currentStageId: stage,
        completed: completedStages,
        action: "can_jump",
        targetStageId: targetId,
        force: opts?.force,
        reason: opts?.reason,
      });
      if (!check.ok) {
        if (!opts?.force) setSkipTarget(targetId);
        else toast.fail(check.reason || "无法跳转");
        return false;
      }
      if (opts?.force) {
        const completed = [...completedStages];
        if (!completed.includes(stage)) completed.push(stage);
        persistCompleted(completed);
        toast.warn(
          check.reason ||
            (opts.reason ? `强制跳转（${opts.reason}）` : "已强制跳转（已记审计标记）"),
        );
      }
      setStage(targetId);
      if (projectId) {
        void api
          .patchProject(projectId, { stage: targetId })
          .then(() => qc.invalidateQueries({ queryKey: ["project", projectId] }))
          .catch(() => toast.fail("同步写作步骤失败"));
      }
      return true;
    },
    [format, stage, completedStages, persistCompleted, projectId, qc],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (!getPrompt(STUDIO_PROMPT_BY_FORMAT[format].promptId)) {
          toast.fail(`格式 ${format} 未配置默认 Prompt`);
          return;
        }
        setPromptOpen(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (synopsisDirty) void saveSynopsis();
        else toast.info("当前没有未保存的梗概改动");
      }
      if (mode === "stage" && (e.key === "[" || e.key === "]")) {
        e.preventDefault();
        const idx = stages.indexOf(stage);
        const next = e.key === "]" ? stages[idx + 1] : stages[idx - 1];
        if (next) void navigateStage(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, stages, mode, navigateStage, synopsisDirty, saveSynopsis]);

  const done = useMemo(() => {
    const set = new Set<string>();
    const progress = project?.progress ?? {};
    for (const s of stages) {
      if (progress[s]) set.add(s);
    }
    const idx = stages.indexOf(project?.stage ?? stages[0]);
    stages.slice(0, Math.max(0, idx)).forEach((s) => set.add(s));
    return set;
  }, [project, stages]);

  const completion = useMemo(
    () => deliverableCompletion(format, artifacts, synopsis),
    [format, artifacts, synopsis],
  );

  // 九格 deep:* 草稿为空时，用已落库产物回填（不覆盖用户本地草稿）
  useEffect(() => {
    if (!projectId || !artifacts.length) return;
    const { filled } = hydrateDeepFromArtifacts(
      projectId,
      artifacts,
      (project?.coverMeta as Record<string, unknown> | undefined) ?? null,
    );
    if (filled.includes("synopsis") && !synopsis.trim()) {
      try {
        const syn = localStorage.getItem(`synopsis:${projectId}`) || "";
        if (syn.trim()) setSynopsis(syn);
      } catch {
        /* ignore */
      }
    }
  }, [projectId, artifacts, project?.coverMeta, synopsis]);

  const adoptedHook = completion.hasHook;
  const hasBio = completion.hasCharacters;
  const outlineReadyCount = completion.outlineReadyCount;
  const bodyReadyCount = completion.bodyReadyCount;
  const emotion =
    (artifacts.find((a) => a.type === "emotion_curve")?.bodyJson as { values?: number[] })
      ?.values ?? [];

  const deliverableDone = completion.done;
  const manuscripts = useMemo(
    () =>
      artifacts
        .filter((a) => bodyTypesFor(format).includes(a.type))
        .sort((a, b) => bodyUnitNo(a) - bodyUnitNo(b)),
    [artifacts, format],
  );

  const adoptedWordCount = useMemo(
    () =>
      manuscripts
        .filter((m) => m.status === "adopted")
        .reduce((sum, m) => {
          const json = m.bodyJson as { wordCount?: number } | undefined;
          const count =
            Number(json?.wordCount ?? 0) || bodyTextOf(m).replace(/\s/g, "").length;
          return sum + count;
        }, 0),
    [manuscripts],
  );
  const targetWords =
    project?.coverMeta?.targetWords != null ? Number(project.coverMeta.targetWords) : null;
  const wordPct = targetWords
    ? Math.min(100, Math.round((adoptedWordCount / Math.max(1, targetWords)) * 100))
    : 0;
  const deadline = deadlineInfo(project?.coverMeta?.deadline);

  const deliverableList = deliverablesForFormat(format);
  const primaryIds = new Set<DeliverableId>(
    format === "manju"
      ? ["hook", "characters", "outline", "manuscript"]
      : ["synopsis", "characters", "outline", "manuscript"],
  );
  const primaryDeliverables = deliverableList.filter((d) => primaryIds.has(d.id));
  const supportDeliverables = deliverableList.filter((d) => !primaryIds.has(d.id));
  const nextDeliverable =
    primaryDeliverables.find((d) => !deliverableDone[d.id]) ??
    supportDeliverables.find((d) => !deliverableDone[d.id]);

  const primaryDoneCount = primaryDeliverables.filter((d) => deliverableDone[d.id]).length;
  const supportDoneCount = supportDeliverables.filter((d) => deliverableDone[d.id]).length;

  const adopt = useMutation({
    mutationFn: ({ id, mode: m }: { id: string; mode: "draft" | "strong" }) =>
      api.adoptArtifact(projectId!, id, m),
    onSuccess: (art) => {
      setFlashId(art.id);
      qc.invalidateQueries({ queryKey: ["artifacts", projectId] });
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      toast.ok("已采纳候选");
      setTimeout(() => setFlashId(null), 700);
    },
    onError: () => toast.fail("采纳失败，请重试"),
  });

  const patchStage = useMutation({
    mutationFn: (s: string) => api.patchProject(projectId!, { stage: s }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project", projectId] }),
  });

  const gates = prompt
    ? checkPromptLock(editable, prompt.requiredPhrases, prompt.lockedHash, prompt.lockedSystem)
    : [];

  const runAgent = async (agentId: string, title: string) => {
    if (!projectId) return;
    const logId = `${Date.now()}`;
    setAgentBusy(true);
    setAgentLog((prev) => [
      { id: logId, title, detail: "正在执行…", tone: "running" },
      ...prev,
    ]);
    try {
      const result = await runAgentFeedback(projectId, agentId, {
        enrichContext: !advisers.data?.agents.some(a=>a.custom && a.id===agentId),
        quiet: true,
        label: title,
      });
      if (result.runId) setLastRunId(result.runId);
      const ok = !result.aborted && result.status !== "failed" && result.status !== "dead";
      setAgentLog((prev) =>
        prev.map((item) =>
          item.id === logId
            ? {
                ...item,
                detail: result.policy
                  ? "待操作员确认（见顶部横幅）"
                  : ok
                    ? "执行完成，可在中间区查看结果"
                    : `结束 · ${result.status}`,
                tone: result.policy ? ("pending" as const) : ok ? ("ok" as const) : ("fail" as const),
              }
            : item,
        ),
      );
      qc.invalidateQueries({ queryKey: ["artifacts", projectId] });
      if (result.runId) qc.invalidateQueries({ queryKey: ["run", result.runId] });
      if (ok && !result.policy) toast.ok(`${title}完成`);
    } catch {
      setAgentLog((prev) =>
        prev.map((item) =>
          item.id === logId
            ? { ...item, detail: "执行失败，请检查网络或稍后重试", tone: "fail" as const }
            : item,
        ),
      );
      toast.fail(`${title}失败`);
    } finally {
      setAgentBusy(false);
    }
  };

  // 复用共享 TropeSearch 的跳转逻辑：书跳知识库文档，桥段跳桥段库并携带筛选词定位。
  const handleTropeSelect = (pick: TropeSearchPick) => {
    if (pick.kind === "trope") {
      void nav({ to: "/kb/tropes", search: { q: pick.trope.name } });
    } else {
      void nav({ to: "/kb/docs/$id", params: { id: pick.book.docId } });
    }
  };

  if (projectsLoading) {
    return (
      <div className="page studio-empty">
        <Panel title={`${formatLabel(format)}创作台`}>
          <div className="studio-empty__body">
            <div>
              <strong>正在载入项目…</strong>
              <p className="muted">同步项目、交稿物与最近一次工作状态。</p>
            </div>
          </div>
        </Panel>
      </div>
    );
  }

  if (!projectId) {
    const sortedProjects = [...projects].sort((a, b) =>
      b.lastOpenedAt.localeCompare(a.lastOpenedAt),
    );
    const hasProjects = projects.length > 0;
    return (
      <div className="page studio-empty studio-project-picker">
        <section className="studio-picker-hero">
          <div className="studio-picker-hero__main">
            <span className="studio-picker-eyebrow">
              {formatLabel(format)} · 创作项目
            </span>
            <h1>
              {hasProjects
                ? `选择要继续的${formatLabel(format)}项目`
                : `启动第一个${formatLabel(format)}项目`}
            </h1>
            <p>
              {search.projectId && hasProjects
                ? "当前链接中的项目不存在，或不属于这个创作格式。请从下面重新选择。"
                : hasProjects
                  ? "每个项目独立保存写作步骤、稿件、AI 助手结果和用量。选错项目不会覆盖原稿。"
                  : "新建项目后就能写正文，也可以先和 AI 讨论人物与大纲。"}
            </p>
            <div className="studio-picker-path" aria-label="交稿主线">
              {primaryDeliverables.map((item, index) => (
                <span key={item.id}>
                  <b>{index + 1}</b>
                  {item.label}
                </span>
              ))}
            </div>
            <div className="studio-picker-actions">
              {!hasProjects ? (
                <Button
                  variant="primary"
                  onClick={() => nav({ to: "/projects/new", search: { format } })}
                >
                  新建{formatLabel(format)}项目
                </Button>
              ) : null}
              <Button variant="ghost" onClick={() => nav({ to: "/kb" })}>
                去知识库找对标
              </Button>
              <Button variant="ghost" onClick={() => nav({ to: "/studio" })}>
                返回创作台
              </Button>
            </div>
          </div>
          <div className="studio-picker-hero__aside" aria-label="协作方式">
            <div>
              <strong>AI 出候选</strong>
              <span>核心梗、人设、大纲、正文批量生成</span>
            </div>
            <div>
              <strong>稿件检查</strong>
              <span>逻辑、期待感、AI 味、合规逐项检查</span>
            </div>
            <div>
              <strong>你做主编</strong>
              <span>筛选、采纳、手改，关键节点必须人工确认</span>
            </div>
          </div>
        </section>

        {sortedProjects.length ? (
          <section className="studio-picker-list">
            <div className="studio-picker-list__head">
              <strong>继续已有项目</strong>
              <span>{sortedProjects.length} 个可编辑项目</span>
            </div>
            {sortedProjects.map((item) => {
              const progress = stageProgressFor(item.format, item.stage);
              return (
                <button
                  key={item.id}
                  type="button"
                  className="studio-project-row"
                  onClick={() =>
                    nav({
                      to: "/studio/$format",
                      params: { format: item.format },
                      search: { projectId: item.id },
                    })
                  }
                >
                  <span className="studio-project-row__mark">{item.title.slice(0, 1)}</span>
                  <span className="studio-project-row__body">
                    <span className="studio-project-row__title">{item.title}</span>
                    <span className="studio-project-row__meta">
                      {progress.done
                        ? `流程已完成 · ${progress.total}/${progress.total} 步`
                        : `${progress.label} · 第 ${progress.index + 1}/${progress.total} 步`}{" "}
                      ·{" "}
                      {new Date(item.updatedAt).toLocaleDateString()}
                    </span>
                    <ProgressBar value={progress.pct} />
                  </span>
                  <span className="studio-project-row__arrow" aria-hidden>
                    →
                  </span>
                </button>
              );
            })}
            <div className="studio-project-list__foot">
              <span className="faint">没有合适的项目？</span>
              <Button
                size="sm"
                onClick={() => nav({ to: "/projects/new", search: { format } })}
              >
                新建{formatLabel(format)}项目
              </Button>
            </div>
          </section>
        ) : (
          <section className="studio-picker-start">
            {[
              ["1", "建项目", "填写标题、题材与一句话方向；不会替你写死核心梗。"],
              ["2", "出候选", "告诉 AI 想写什么，检查候选稿后再决定是否采用。"],
              ["3", "做取舍", "采纳一篇进入大纲；未采纳候选保留，方便回看和对比。"],
              ["4", "过门禁", "交稿包只统计真实采纳物，缺项会明确列出，不做假完成。"],
            ].map(([step, label, detail]) => (
              <div key={step} className="studio-picker-start__card">
                <b>{step}</b>
                <div>
                  <strong>{label}</strong>
                  <span>{detail}</span>
                </div>
              </div>
            ))}
          </section>
        )}
      </div>
    );
  }

  const manuscriptRequested = mode === "episodes" || (mode === "deliverable" && deliverable === "manuscript");
  const access = manuscriptAccess(artifactQuery.status);
  const title =
    mode === "episodes"
      ? (["short_novel", "male_long", "female_long"].includes(format) ? "章节正文" : "分集正文")
      : mode === "deliverable"
      ? (deliverableList.find((d) => d.id === deliverable)?.label ?? "交稿物")
      : mode === "ontology"
      ? "项目审计"
      : (labels[stage] ?? "当前写作步骤");

  const renderRailItem = (d: (typeof deliverableList)[number]) => {
    const isDone = !!deliverableDone[d.id];
    const isActive = deliverable === d.id;
    return (
      <button
        key={d.id}
        type="button"
        className="binder-item"
        data-active={isActive}
        data-done={isDone}
        onClick={() => {
          setMode("deliverable");
          setDeliverable(d.id);
          setRailDrawerOpen(false);
        }}
      >
        <span className="binder-item__check">
          <StepStatusIcon done={isDone} active={isActive && !isDone} />
        </span>
        <span className="binder-item__text">
          <span className="binder-item__label">{d.label}</span>
          <span className="binder-item__hint">{d.hint}</span>
        </span>
      </button>
    );
  };

  const activeSupport = supportDeliverables.find((d) => d.id === deliverable);

  const railContent = (
    <>
      <div className="studio__rail-head">
        <div className="studio__rail-title">{project?.title}</div>
        {projects.length > 1 ? (
          <Select
            className="select studio__project-select"
            value={projectId}
            aria-label="切换项目"
            onChange={(event) =>
              nav({
                to: "/studio/$format",
                params: { format },
                search: { projectId: event.target.value },
              })
            }
          >
            {projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </Select>
        ) : null}
        <div className="studio__rail-meta">
          {formatLabel(format)}
        </div>
        <div className="studio__rail-stats">
          <span data-tone={deliverableDone.package ? "ok" : "idle"}>
            投稿包 {deliverableDone.package ? "已齐" : "未齐"}
          </span>
          <span>
            精修 {supportDoneCount}/{supportDeliverables.length}
          </span>
        </div>
        <div className="studio__mode-switch" role="tablist" aria-label="创作视图">
          <button
            type="button"
            role="tab"
            className="studio__seg"
            data-active={mode === "deliverable"}
            aria-selected={mode === "deliverable"}
            onClick={() => setMode("deliverable")}
          >
            交稿物
          </button>
          <button
            type="button"
            role="tab"
            className="studio__seg"
            data-active={mode === "episodes"}
            aria-selected={mode === "episodes"}
            onClick={() => setMode("episodes")}
          >
            {["short_novel", "male_long", "female_long"].includes(format) ? "章节" : "分集"}
          </button>
          <button
            type="button"
            role="tab"
            className="studio__seg"
            data-active={mode === "ontology"}
            aria-selected={mode === "ontology"}
            onClick={() => setMode("ontology")}
          >
            审计
          </button>
            <button
              type="button"
              role="tab"
              className="studio__seg"
              data-active={mode === "stage"}
              aria-selected={mode === "stage"}
              onClick={() => setMode("stage")}
            >
              流程
            </button>
        </div>
      </div>

      <div className="studio__rail-nav">
        {mode === "deliverable" ? (
          <>
            <CollapsibleSection
              bare
              title="交稿主线"
              badge={`${primaryDoneCount}/${primaryDeliverables.length}`}
              summary={`${primaryDoneCount}/${primaryDeliverables.length} 达标`}
              defaultOpen
              storageKey={`studio-${format}-primary`}
            >
              {primaryDeliverables.map(renderRailItem)}
            </CollapsibleSection>
            <CollapsibleSection
              bare
              title={format === "manju" ? "交稿与精修" : "精修与交付"}
              badge={`${supportDoneCount}/${supportDeliverables.length}`}
              summary={activeSupport?.label}
              defaultOpen
              storageKey={`studio-${format}-support`}
            >
              {supportDeliverables.map(renderRailItem)}
            </CollapsibleSection>
          </>
        ) : mode === "episodes" ? (
          <div className="stack" style={{ gap: 6, padding: "0 8px" }}>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              选择一篇正文即可打开编辑器。
            </p>
            {manuscripts.length === 0 ? (
              <div className="empty">从编辑器开始写第一篇正文，保存后会出现在这里。</div>
            ) : (
              manuscripts.map((m) => {
                const b = m.bodyJson as { episodeNo?: number; wordCount?: number };
                const outline = artifacts.find(
                  (a) =>
                    a.type === "episode_outline" &&
                    Number((a.bodyJson as { episodeNo?: number })?.episodeNo) ===
                      Number(b.episodeNo),
                );
                const ob = outline?.bodyJson as
                  | {
                      anchors?: Array<{ id: string; kind: BeatKind; label?: string }>;
                      cliffType?: string;
                      cliffText?: string;
                      emotionPeak?: number;
                    }
                  | undefined;
                const tags: Array<{ kind: BeatKind; label: string }> = [];
                if (Array.isArray(ob?.anchors) && ob.anchors.length) {
                  for (const a of ob.anchors) {
                    if (tags.length < 3) {
                      tags.push({ kind: a.kind, label: a.label || KIND_META[a.kind]?.label || a.kind });
                    }
                  }
                } else {
                  if (ob?.cliffType || ob?.cliffText) {
                    tags.push({ kind: "cliff", label: ob.cliffType || "卡点" });
                  }
                  if (typeof ob?.emotionPeak === "number") {
                    tags.push({ kind: "emotion_peak", label: `情绪${ob.emotionPeak}` });
                  }
                }
                return (
                  <button
                    key={m.id}
                    type="button"
                    className="binder-item"
                    data-active={m.id === activeManuscriptId}
                    onClick={() => {
                      setActiveManuscriptId(m.id);
                      setRailDrawerOpen(false);
                    }}
                  >
                    <span className="binder-item__check" data-done={m.status === "adopted" ? "true" : undefined}>
                      <StepStatusIcon done={m.status === "adopted"} active={m.id === activeManuscriptId} />
                    </span>
                    <span className="binder-item__text">
                      <span className="binder-item__label">
                        {m.type === "scene"
                          ? `场 ${((m.bodyJson as { scene_header?: string } | undefined)?.scene_header ?? (bodyUnitNo(m) || "?"))}`
                          : `第${bodyUnitNo(m) || "?"}${
                              format === "manju" || format === "duanju" || format === "ip_adapt"
                                ? "集"
                                : "章"
                            }`}
                      </span>
                      <span className="binder-item__hint">
                        {Number(b.wordCount ?? 0) || bodyTextOf(m).replace(/\s/g, "").length} 字 ·{" "}
                        {m.status === "adopted" ? "定稿" : "草稿"}
                      </span>
                      {tags.length > 0 && (
                        <span className="row" style={{ gap: 4, marginTop: 2, flexWrap: "wrap" }}>
                          {tags.map((t, i) => (
                            <span
                              key={i}
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                color: KIND_META[t.kind]?.color ?? "var(--ink-muted)",
                                border: `1px solid ${KIND_META[t.kind]?.color ?? "var(--ink-muted)"}`,
                                borderRadius: 999,
                                padding: "0 5px",
                                lineHeight: 1.5,
                              }}
                            >
                              {t.label}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        ) : mode === "ontology" ? (
          <div className="stack" style={{ gap: 6, padding: "0 8px" }}>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              对象 / Action 审计 / 情景分支；连续性图见「交稿物」的剧情连续性图。
            </p>
          </div>
        ) : (
          <CollapsibleSection
            bare
            title="写作步骤"
            badge={`${done.size}/${stages.length}`}
            storageKey={`studio-${format}-stages`}
          >
            <StageRail
              stages={stages}
              current={stage}
              done={done}
              labels={labels}
              onSelect={(s, locked) => {
                if (locked) setSkipTarget(s);
                else {
                  setStage(s);
                  setRailDrawerOpen(false);
                }
              }}
            />
          </CollapsibleSection>
        )}
      </div>
    </>
  );

  const sideContent = (
    <>
      <Tabs
        tabs={[
          { id: "agent", label: "助手" },
          { id: "replay", label: "回放" },
          { id: "kb", label: "知识" },
          { id: "memory", label: "记忆" },
          { id: "feedback", label: "反馈" },
        ]}
        value={sideTab}
        onChange={setSideTab}
      />
      {sideTab === "agent" && (
        <div className="stack studio-assistant-stack">
          <p className="studio-copilot-hint">
            {agentBusy
              ? "AI 正在执行任务，结果会同步到中间创作区。"
              : "查看创作地图、确认流程节点，或让 AI 助手开始写作。"}
          </p>
          {advisers.data?.agents.filter(a=>a.custom).map(a=><Button key={a.id} disabled={agentBusy} onClick={()=>void runAgent(a.id,a.name)}>请{a.name}核查本项目资料</Button>)}
          {agentBusy && <StatusBadge tone="running" label="AI 正在写作" />}
          <CollapsibleSection
            title="创作地图"
            summary={labels[stage] ?? "当前写作步骤"}
            storageKey={`studio-${format}-assistant-map`}
          >
            <CreationMap
              format={format}
              currentStageId={stage}
              completed={completedStages}
              compact
              onSelectStage={(id) => {
                void navigateStage(id);
              }}
              onRunAgent={(agentId) => {
                void runAgent(agentId, `运行 ${agentId}`);
              }}
            />
          </CollapsibleSection>
          {migrationHint && (
            <CollapsibleSection
              title="项目迁移提示"
              badge="需处理"
              storageKey={`studio-${format}-assistant-migration`}
            >
              <p className="muted" style={{ fontSize: 12 }}>{migrationHint}</p>
              <Button size="sm" onClick={() => setMigrationHint(null)}>
                知道了
              </Button>
            </CollapsibleSection>
          )}
          <CollapsibleSection
            title="流程确认"
            badge={labels[stage] ?? "当前写作步骤"}
            storageKey={`studio-${format}-assistant-ack`}
          >
            <p className="muted" style={{ fontSize: 12 }}>
              人工节点须「确认本步」后才能前进；强制跳过会记入审计。
            </p>
            <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
              <Button
                onClick={() => {
                  void ackCurrentStage();
                }}
              >
                确认本步
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  void (async () => {
                    const res = await api.stageLock({
                      format,
                      currentStageId: stage,
                      completed: completedStages,
                      action: "advance",
                    });
                    if (res.migrationHint) setMigrationHint(res.migrationHint);
                    if (!res.ok) {
                      setSkipTarget(
                        stageGraph?.stages.find((s) => s.id === stage)?.next?.[0] || null,
                      );
                      toast.fail(res.reason || "需先确认本步");
                      return;
                    }
                    if (res.state?.completed) persistCompleted(res.state.completed);
                    if (res.state?.currentStageId) {
                      setStage(res.state.currentStageId);
                      patchStage.mutate(res.state.currentStageId);
                    }
                    toast.ok("已前进到下一步");
                  })();
                }}
              >
                前进下一步
              </Button>
            </div>
          </CollapsibleSection>
          {agentLog.length > 0 && (
            <CollapsibleSection
              title="执行记录"
              badge={agentLog.length}
              summary={agentBusy ? "AI 正在写作" : "最近任务"}
              storageKey={`studio-${format}-assistant-log`}
            >
              <AgentTimeline items={agentLog} />
            </CollapsibleSection>
          )}
          <CollapsibleSection
            title="Run 回执"
            summary={lastRunId ? lastRunId.slice(0, 8) : "运行后显示"}
            defaultOpen={false}
            storageKey={`studio-${format}-assistant-receipt`}
          >
            {lastRunId ? (
              <RunReceiptPanel runId={lastRunId} />
            ) : (
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                运行任务后，在这里查看交付要求、检查结果与用量。
              </p>
            )}
          </CollapsibleSection>
        </div>
      )}
      {sideTab === "replay" && (
        <div className="stack" style={{ marginTop: 10 }}>
          <ProjectReplayPanel projectId={projectId} selectedRunId={lastRunId} />
        </div>
      )}
      {sideTab === "kb" && (
        <div className="stack" style={{ marginTop: 10 }}>
          <KbBindPanel
            projectId={projectId}
            benchmark={project?.coverMeta?.benchmark}
          />
          <TropeSearch onSelect={handleTropeSelect} />
          <KnowledgeQuickSearch />
        </div>
      )}
      {sideTab === "feedback" && <FeedbackLoopPanel projectId={projectId} artifacts={artifacts} format={format} />}
      {sideTab === "memory" && (
        <div className="stack" style={{ marginTop: 10, gap: 12 }}>
          <MemoryProjectPanel projectId={projectId} />
          {projectId && <AnalyticsPanel projectId={projectId} />}
        </div>
      )}
    </>
  );

  return (
    <div
      className="studio"
      data-side-collapsed={sideCollapsed ? "true" : "false"}
      data-rail-open={railDrawerOpen ? "true" : "false"}
    >
      <aside className="studio__rail">{railContent}</aside>

      <main className="studio__main">
        {Object.keys((project?.progress?.artifactReviewRequired || {}) as Record<string, unknown>).length > 0 && <div role="status" className="help-callout" style={{margin:"8px 12px"}}>上游稿件已修改，部分内容需要重新复核。原稿和编辑保留，请检查版本差异后再采纳或确认逻辑。</div>}
      <StudioOnboarding />
        {(deadline || targetWords != null) && (
          <div
            className="row"
            style={{
              gap: 10,
              padding: "6px 14px",
              borderBottom: "1px solid var(--line)",
              flexWrap: "wrap",
            }}
          >
            {deadline && deadline.tone !== "idle" ? (
              <StatusBadge
                tone={deadline.tone === "fail" ? "fail" : "warn"}
                label={`截止：${deadline.label}`}
              />
            ) : null}
            {targetWords != null && (
              <div className="row" style={{ gap: 6, flex: 1, minWidth: 200 }}>
                <span className="faint" style={{ fontSize: "var(--fs-xs)", whiteSpace: "nowrap" }}>
                  正文字数 {adoptedWordCount.toLocaleString()} / {targetWords.toLocaleString()}
                </span>
                <ProgressBar value={wordPct} style={{ flex: 1 }} />
              </div>
            )}
          </div>
        )}
        <div className="studio-toolbar">
          <div className="studio-toolbar__lead">
            <div className="row studio-toolbar__title-row">
              <Button
                variant="ghost"
                size="sm"
                className="app-nav__mobile-toggle"
                aria-label="项目导航"
                onClick={() => setRailDrawerOpen(true)}
              >
                <Rows3 size={16} />
              </Button>
              <h2>{title}</h2>
              <StatusBadge
                tone={agentBusy ? "running" : deliverableDone[deliverable] ? "ok" : "idle"}
                label={agentBusy ? "生成中" : deliverableDone[deliverable] ? "已完成" : "编辑中"}
              />
              {synopsisDirty ? (
                <StatusBadge tone="warn" label={synopsisEdited ? "梗概未保存" : "本地梗概草稿"} />
              ) : null}
            </div>
            <div className="studio-toolbar__sub">
              {mode === "deliverable"
                ? synopsisDirty
                  ? "梗概有未保存改动 · ⌘/Ctrl+S 保存"
                  : "按交稿结构组织内容 · AI 出候选，你来定稿"
                : "⌘/Ctrl+Enter 打开写作指令 · [ ] 切换步骤"}
            </div>
          </div>
          <div className="studio-toolbar__actions">
            <span className="studio-token">
              <TokenChip used={project?.tokenUsed} estimate={15000} />
            </span>
            {project?.budgetTokens != null && project.tokenUsed >= project.budgetTokens ? (
              <StatusBadge tone="warn" label="预算已满" />
            ) : null}
            <div className="studio__mode-switch" role="tablist" aria-label="创作模式">
              {(
                [
                  ["auto", "批量生成"],
                  ["semi", "AI协作"],
                  ["manual", "手写并优化"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  className="studio__seg"
                  data-active={creationMode === key}
                  aria-selected={creationMode === key}
                  title={
                    key === "auto"
                      ? "查看批量生成范围与确认方式"
                      : key === "semi"
                        ? "逐步跑，关键步骤人工确认"
                        : "打开正文编辑器"
                  }
                  onClick={() => {
                    setCreationMode(key);
                    try { localStorage.setItem(`creation-mode:${format}`, key); } catch { /* storage unavailable */ }
                    if (key === "manual") setMode("episodes");
                    if (key === "semi") setCowriteOpen(true);
                    if (key === "auto") setAutopilotOpen(true);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {mode === "deliverable" && nextDeliverable ? (
              <Button
                variant={creationMode === "auto" ? "ghost" : "primary"}
              onClick={() => {
                setMode("deliverable");
                setDeliverable(nextDeliverable.id);
              }}
                title={nextDeliverable.hint}
              >
                下一步 · {nextDeliverable.label}
              </Button>
            ) : null}
            <Button onClick={() => setCowriteOpen(true)}>共写</Button>
            <Button
              variant={creationMode === "auto" ? "primary" : "ghost"}
              onClick={() => setAutopilotOpen(true)}
            >
              一键补全
            </Button>
            <Button
              onClick={() => {
                if (!prompt) {
                  toast.fail(`格式 ${format} 未配置默认 Prompt，无法开跑`);
                  return;
                }
                setPromptOpen(true);
              }}
            >
              Prompt
            </Button>
            {mode === "stage" && (
              <Button
                variant="primary"
                onClick={() => {
                  let logline100 = "";
                  try {
                    logline100 = projectId
                      ? localStorage.getItem(`logline100:${projectId}`) || ""
                      : "";
                  } catch {
                    logline100 = "";
                  }
                  const gate = canAdvanceStage(format, stage, completion, {
                    synopsis,
                    logline100,
                  });
                  if (!gate.ok) {
                    toast.fail(gate.reason || "本步尚无对应交稿内容，无法标记完成");
                    if (gate.need) {
                      setDeliverable(gate.need as DeliverableId);
                      setMode("deliverable");
                    }
                    return;
                  }
                  const completed = [...completedStages];
                  if (!completed.includes(stage)) completed.push(stage);
                  persistCompleted(completed);
                  patchStage.mutate(stage);
                  const idx = stages.indexOf(stage);
                  if (stages[idx + 1]) setStage(stages[idx + 1]);
                  toast.ok("已完成本步");
                }}
              >
                完成并前进
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              aria-label={sideCollapsed ? "展开助手" : "收起助手"}
              onClick={() => {
                if (window.innerWidth <= 1280) {
                  setSideDrawerOpen(true);
                } else {
                  setSideCollapsed((v) => !v);
                }
              }}
            >
              {sideCollapsed ? <PanelRight size={16} /> : <PanelRightClose size={16} />}
            </Button>
          </div>
        </div>

        <div
          className="studio__main-canvas"
          key={`${mode}-${mode === "deliverable" ? deliverable : mode === "episodes" ? "episodes" : stage}`}
          data-view={mode}
        >
          {mode === "ontology" && <OntologyPanel projectId={projectId} />}
          {manuscriptRequested && access !== "edit" && (
            <div role="status">{access === "loading" ? "正在读取正文…" : <>正文读取失败。<Button onClick={() => void artifactQuery.refetch()}>重新读取</Button></>}</div>
          )}
          {mode === "episodes" && access === "edit" && (
            <ManuscriptStudio key={projectId}
              artifacts={artifacts}
              projectId={projectId}
              activeId={activeManuscriptId}
              format={format}
            />
          )}
          {format === "manju" && mode === "deliverable" && deliverable === "package" && (
            <PackagePanel
              hasHook={adoptedHook}
              hasBio={hasBio}
              outlineCount={outlineReadyCount}
              bodyCount={bodyReadyCount}
              synopsis={synopsis}
              projectId={projectId}
              format={format}
              artifacts={artifacts}
              projectTitle={project?.title}
            />
          )}
          {format === "manju" && mode === "deliverable" && deliverable === "hook" && (
            <ManjuStagePanel
              stage="S2_HOOK_SELECT"
              projectId={projectId}
              artifacts={artifacts}
              flashId={flashId}
              onAdopt={(id, m) => adopt.mutate({ id, mode: m })}
            />
          )}
          {format === "manju" && mode === "deliverable" && deliverable === "synopsis" && (
            <SynopsisPanel key={projectId}
              value={synopsis}
              onChange={editSynopsis}
              projectId={projectId}
              format={format}
            />
          )}
          {format === "manju" && mode === "deliverable" && deliverable === "setting" && (
            <SettingPanel projectId={projectId} />
          )}
          {format === "manju" && mode === "deliverable" && deliverable === "characters" && (
            <CharacterBiblePanel
              artifacts={artifacts}
              projectId={projectId}
              format={format}
            />
          )}
          {format === "manju" && mode === "deliverable" && deliverable === "outline" && (
            <OutlineDualView artifacts={artifacts} projectId={projectId} />
          )}
          {format === "manju" && mode === "deliverable" && deliverable === "emotion" && (
            <EmotionCurvePanel values={emotion} projectId={projectId} artifacts={artifacts} />
          )}
          {format === "manju" && mode === "deliverable" && deliverable === "manuscript" && access === "edit" && (
            <ManuscriptStudio key={projectId}
              artifacts={artifacts}
              projectId={projectId}
              activeId={activeManuscriptId}
              format={format}
            />
          )}
          {format === "manju" && mode === "deliverable" && deliverable === "foresight" && (
            <ForesightPanel projectId={projectId} />
          )}
          {format === "manju" && mode === "deliverable" && deliverable === "qc" && (
            <QcGatePanel projectId={projectId} format={format} />
          )}

          {format === "manju" && mode === "stage" && (
            <ManjuStagePanel
              stage={stage}
              projectId={projectId}
              artifacts={artifacts}
              flashId={flashId}
              onAdopt={(id, m) => adopt.mutate({ id, mode: m })}
              onStageAck={ackCurrentStage}
            />
          )}

          {format !== "manju" && mode !== "episodes" && mode !== "ontology" && (!manuscriptRequested || access === "edit") && (
            <Suspense fallback={<div className="muted">加载格式工作台…</div>}>
              <FormatDeliverableWorkspace
                format={format}
                deliverable={deliverable}
                stage={stage}
                stageLabel={labels[stage] ?? "当前写作步骤"}
                mode={mode}
                artifacts={artifacts}
                projectId={projectId}
                projectTitle={project?.title}
                synopsisValue={synopsis}
                onSynopsisChange={editSynopsis}
              />
            </Suspense>
          )}
        </div>
      </main>

      <aside className="studio__side">
        <div className="studio__side-head">
          <strong style={{ fontSize: "var(--fs-sm)" }}>AI 助手</strong>
        </div>
        <div className="studio__side-body">{sideContent}</div>
      </aside>

      <Drawer
        open={sideDrawerOpen}
        onOpenChange={setSideDrawerOpen}
        title="AI 助手"
        side="right"
        width={360}
      >
        {sideContent}
      </Drawer>

      <Drawer
        open={railDrawerOpen}
        onOpenChange={setRailDrawerOpen}
        title="项目导航"
        side="left"
        width={280}
      >
        {railContent}
      </Drawer>

      <Drawer
        open={cowriteOpen}
        onOpenChange={setCowriteOpen}
        title="AI 共写"
        side="right"
        width={640}
      >
        <CowritePanel projectId={projectId} />
      </Drawer>

      <AutopilotDrawer
        key={creationMode}
        initialMode={creationMode === "auto" ? "auto" : "step"}
        open={autopilotOpen}
        onClose={() => setAutopilotOpen(false)}
        projectId={projectId}
        format={format}
        hasHook={adoptedHook}
        hasCharacters={hasBio}
        outlineReadyCount={outlineReadyCount}
        outlineTarget={completion.outlineTarget}
        bodyReadyCount={bodyReadyCount}
        bodyTarget={completion.bodyTarget}
        onDone={() => setAutopilotOpen(false)}
      />

      <ConfirmDialog
        open={!!skipTarget}
        title="强制跳过当前步骤？"
        description="默认禁止跳过未完成步骤。强制跳转会写入审计记录。"
        confirmLabel="强制跳转"
        danger
        onOpenChange={(o) => !o && setSkipTarget(null)}
        onConfirm={() => {
          if (!skipTarget) return;
          void (async () => {
            const ok = await navigateStage(skipTarget, {
              force: true,
              reason: "用户强制跳过未完成步骤",
            });
            if (ok) setSkipTarget(null);
          })();
        }}
      />

      {prompt && (
        <PromptDrawer
          open={promptOpen}
          lockedSystem={prompt.lockedSystem}
          editableInstruction={editable}
          onEditableChange={setEditable}
          gates={gates}
          onClose={() => setPromptOpen(false)}
          onRun={() => {
            setPromptOpen(false);
            void runAgent(promptAgentId, studioPrompt.runLabel);
          }}
        />
      )}
    </div>
  );
}
