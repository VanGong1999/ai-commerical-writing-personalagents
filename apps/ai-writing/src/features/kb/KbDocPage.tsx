import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import {
  Badge,
  Button,
  ConfirmDialog,
  HelpCallout,
  HelpIcon,
  HelpTip,
  PageHeader,
  Panel,
  Tabs,
  toast,
} from "@xiezuomanju/ui";
import { Select } from "@xiezuomanju/ui";
import { useEffect, useMemo, useState } from "react";
import type { ProjectFormat } from "@xiezuomanju/domain";
import { api } from "../../api/client";
import { ReportReader } from "./ReportReader";
import { fieldLabel, getReportMeta } from "./reportMeta";
import { SwapWorkspace } from "./SwapWorkspace";
import { ManuscriptAnnotatedView } from "../studio/ManuscriptAnnotatedView";
import { KIND_META, type BeatKind } from "../studio/BeatMapPanel";

type PushMode = "dissect" | "swap" | "imitate";

const PUSH_HELP: Record<PushMode, string> = {
  dissect: "把拆解参数带进项目，适合从参考作品起步写大纲或核心梗。",
  swap: "带着换元思路进项目，适合一度/二度置换后再写。",
  imitate: "带着仿写节奏进项目，学结构与爽点密度，不抄原文。",
};

const STATUS_LABEL: Record<string, string> = {
  ready: "已就绪",
  analyzing: "分析中",
  indexed: "已入库",
  failed: "失败",
};

function formatFromDocType(docType?: string): ProjectFormat {
  if (docType === "script_manju") return "manju";
  if (docType === "script_duanju") return "duanju";
  return "short_novel";
}

type Anchor = { id: string; kind: BeatKind; label: string };

function extractAnchors(reports: Array<{ bodyJson?: Record<string, unknown> | null }>): Anchor[] {
  const out: Anchor[] = [];
  for (const r of reports) {
    const b = (r.bodyJson ?? {}) as Record<string, unknown>;
    const ec = (b.values ?? b.emotionCurve ?? []) as Array<number | Record<string, unknown>>;
    for (const p of ec.slice(0, 20)) {
      if (typeof p === "object" && p) {
        const label = p.beatLabel ?? p.label;
        if (label) out.push({ id: `e${out.length}`, kind: "emotion_peak", label: String(label) });
      }
    }
    const hooks = (b.hooks ?? b.extractedHooks ?? []) as Array<Record<string, unknown>>;
    for (const h of hooks.slice(0, 10)) {
      const label = h.titleHook ?? h.coreHook;
      if (label) out.push({ id: `h${out.length}`, kind: "cliff", label: String(label) });
    }
    const cool = (b.cool ?? b.coolPoints ?? b.coolPain ?? []) as Array<Record<string, unknown> | string>;
    for (const c of cool.slice(0, 10)) {
      const label = typeof c === "string" ? c : (c.name ?? c.label);
      if (label) out.push({ id: `c${out.length}`, kind: "cool", label: String(label) });
    }
    const rels = (b.relationships ?? []) as Array<{ from?: string; to?: string }>;
    for (const rel of rels.slice(0, 10)) {
      if (rel.from || rel.to) {
        out.push({ id: `r${out.length}`, kind: "beat", label: `${rel.from ?? ""} → ${rel.to ?? ""}` });
      }
    }
  }
  return out.slice(0, 40);
}

export function KbDocPage() {
  const { id } = useParams({ from: "/kb/docs/$id" });
  const { report: requestedReport } = useSearch({ from: "/kb/docs/$id" });
  const nav = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState("reports");
  const [reportId, setReportId] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [pushMode, setPushMode] = useState<PushMode>("dissect");
  const [projectId, setProjectId] = useState("");
  const [reportQ, setReportQ] = useState("");
  const [showDigests,setShowDigests]=useState(false);
  const [runningReport, setRunningReport] = useState<string | null>(null);
  const [analyzeProgress, setAnalyzeProgress] = useState("");
  const [analysisScope,setAnalysisScope]=useState<"sample" | "full">("sample");
  const [error, setError] = useState<string | null>(null);

  const { data: doc } = useQuery({
    queryKey: ["kb-doc", id],
    queryFn: () => api.getDoc(id),
  });
  const { data: allReports = [] } = useQuery({
    queryKey: ["kb-reports", id],
    queryFn: () => api.listReports(id),
  });
  const reports = useMemo(()=>allReports.filter(r=>showDigests || r.reportType !== "chapter_digest"),[allReports,showDigests]);
  const { data: docText } = useQuery({
    queryKey: ["kb-doc-text", id],
    queryFn: () => api.getDocText(id),
  });
  const { data: similar } = useQuery({
    queryKey: ["kb-similar", id],
    queryFn: () => api.similarDocs(id),
  });
  const [anchorSel, setAnchorSel] = useState<string | null>(null);
  const anchors = useMemo(() => extractAnchors(reports), [reports]);
  const anchorHit = useMemo(() => {
    if (!anchorSel || !docText?.text) return null;
    const a = anchors.find((x) => x.id === anchorSel);
    if (!a) return null;
    const needle = a.label.split("→")[0]?.trim().slice(0, 12) ?? "";
    if (!needle) return null;
    const idx = docText.text.indexOf(needle);
    if (idx < 0) return { found: false, context: "" };
    return {
      found: true,
      context: docText.text.slice(Math.max(0, idx - 40), idx + 80),
    };
  }, [anchorSel, anchors, docText]);
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects(),
  });
  const { data: bindings = [] } = useQuery({
    queryKey: ["kb-bindings", id],
    queryFn: () => api.listKbBindings(id),
  });

  useEffect(() => {
    if (!projectId && projects[0]?.id) setProjectId(projects[0].id);
  }, [projects, projectId]);

  useEffect(() => {
    if (!requestedReport || !reports.length) return;
    const candidates: Record<string, string[]> = {
      dissect: ["dissect_params"],
      unit: ["unit_story"],
      core: ["core_hook_extract", "core_hook"],
      style: ["style_extract", "style_profile"],
      gap: ["gap_report"],
    };
    const types = candidates[requestedReport] ?? [requestedReport];
    const match = reports.find((report) => types.includes(report.reportType));
    if (match) {
      setTab("reports");
      setReportId(match.id);
    }
  }, [requestedReport, reports]);

  const push = useMutation({
    mutationFn: (mode: PushMode) => {
      if (!projectId) throw new Error("请先选择要写入的写作项目");
      return api.pushToProject(id, projectId, mode);
    },
    onSuccess: (res) => nav({ to: "/projects/$id", params: { id: res.projectId } }),
    onError: (e: Error) => setError(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: () => api.deleteKbDoc(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kb-docs"] });
      nav({ to: "/kb" });
    },
    onError: (e: Error) => setError(e.message),
  });

  const analyzeMut = useMutation({
    mutationFn: () => api.analyzeKbDoc(id,analysisScope),
    onSuccess: async (res) => {
      setRunningReport(res.jobId);
      setAnalyzeProgress(`已排队：${res.analysisScope === "full" ? "全书分块深拆" : "片段快速分析"}；预计 ${res.estimatedChunks ?? 1} 个分块、最多约 ${res.estimatedCalls ?? 12} 次模型请求（已完成分块可复用）。\n`);
      try {
        for await (const ev of api.getJobEvents(res.jobId)) {
          const token =
            (typeof ev.token === "string" && ev.token) ||
            (typeof ev.text === "string" && ev.text) ||
            "";
          if (token) setAnalyzeProgress((p) => p + token);
          if (ev.type === "done" || ev.status === "succeeded" || ev.status === "failed") break;
        }
      } catch {
        /* ignore */
      }
      setRunningReport(null);
      qc.invalidateQueries({ queryKey: ["kb-reports", id] });
      qc.invalidateQueries({ queryKey: ["kb-doc", id] });
    },
    onError: (e: Error) => {
      setRunningReport(null);
      setError(e.message);
    },
  });

  const toggleFav = useMutation({
    mutationFn: (r: { id: string; favorited: boolean }) =>
      api.patchReport(id, r.id, { favorited: !r.favorited }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kb-reports", id] }),
    onError: (e: Error) => setError(e.message),
  });

  const revokeMut = useMutation({
    mutationFn: (bindingId: string) => api.revokeKbBinding(id, bindingId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kb-bindings", id] });
      toast.ok("已撤销绑定");
    },
    onError: (e: Error) => setError(e.message),
  });

  if (!doc) return <div className="page">正在打开文档…</div>;

  const visibleReports = reports.filter((r) => {
    if (!reportQ.trim()) return true;
    const hay = `${r.title} ${r.reportType} ${r.bodyMarkdown}`.toLowerCase();
    return hay.includes(reportQ.trim().toLowerCase());
  });
  const activeReport = visibleReports.find((r) => r.id === reportId) ?? visibleReports[0];
  const activeMeta = activeReport
    ? getReportMeta(activeReport.reportType, activeReport.title)
    : null;
  const pipeline = [
    {
      label: "解析清洗",
      done: (doc.wordCount ?? 0) > 0,
      detail: `${(doc.wordCount ?? 0).toLocaleString()} 字`,
    },
    {
      label: "分类打标",
      done: doc.tags.length > 0,
      detail: `${doc.tags.length} 个标签`,
    },
    {
      label: "切片入库",
      done: doc.status === "ready" || doc.status === "indexed",
      detail: STATUS_LABEL[doc.status] ?? doc.status,
    },
    {
      label: "拆解报告",
      done: reports.length > 0,
      detail: `${reports.length} 份`,
    },
  ];

  return (
    <div className="page page--wide">
      <PageHeader
        title={doc.title}
        description={`${STATUS_LABEL[doc.status] ?? doc.status} · 约 ${doc.wordCount?.toLocaleString() ?? 0} 字`}
        breadcrumb={
          <Button variant="ghost" size="sm" onClick={() => nav({ to: "/kb" })}>
            ← 返回知识库
          </Button>
        }
        actions={
          <>
            <HelpTip label="用关系图看清人物站队与冲突线，写小传前先看一眼。">
              <Button onClick={() => nav({ to: "/kb/graph/$id", params: { id } })}>
                看人物关系
              </Button>
            </HelpTip>
            <label className="field" style={{minWidth:180}}><span>分析深度</span><select className="input" value={analysisScope} onChange={e=>setAnalysisScope(e.target.value as "sample" | "full")}><option value="sample">片段快速分析</option><option value="full">全书分块深拆</option></select><small className="muted">全书约 {Math.max(1,Math.ceil((doc?.wordCount || 0)/8000))} 个分块，先逐块分析再汇总，耗时与用量随篇幅增加。</small></label>
            <HelpTip label="后台分析，结果会注明来源范围。全书模式按块保存进度，中断后重试可复用完成的分块。">
              <Button
                variant="ghost"
                disabled={analyzeMut.isPending || !!runningReport}
                onClick={() => {
                  setError(null);
                  analyzeMut.mutate();
                }}
              >
                {runningReport ? "分析中，请稍候…" : "重新拆解分析"}
              </Button>
            </HelpTip>
            <Button variant="danger" onClick={() => setConfirmDel(true)}>
              删除文档
            </Button>
          </>
        }
      />

      {runningReport && (
        <Panel title="分析进度" style={{ marginBottom: 12 }}>
          <div
            className="muted"
            style={{
              fontSize: 12,
              maxHeight: 120,
              overflowY: "auto",
              whiteSpace: "pre-wrap",
              fontFamily: "var(--font-mono, monospace)",
            }}
          >
            {analyzeProgress || "正在排队…"}
          </div>
        </Panel>
      )}

      {error && (
        <div className="row" style={{ marginBottom: 8 }}>
          <Badge tone="fail">{error}</Badge>
        </div>
      )}

      <HelpCallout title="怎么用这份参考作品" tone="info" collapsible defaultOpen={false}>
        1）左侧点选一种报告，先读「是做什么的」；2）记下可抄的节奏/钩子，不要整段照搬；3）选好项目后点「应用到写作台」，继续写你的梗与大纲。
        <HelpIcon text="拆解是为了学「怎么写」，不是洗稿。一度换元换皮，二度换元换关系与动机。" />
      </HelpCallout>

      <div className="row" style={{ margin: "8px 0 12px" }}>
        {doc.tags.map((t) => (
          <Badge key={t}>{t}</Badge>
        ))}
      </div>

      <div className="kb-pipeline" aria-label="文档分析流水线">
        {pipeline.map((step, index) => (
          <div key={step.label} className="kb-pipeline__step" data-done={step.done}>
            <span className="kb-pipeline__index">{index + 1}</span>
            <span className="kb-pipeline__body">
              <strong>{step.label}</strong>
              <span>{step.detail}</span>
            </span>
          </div>
        ))}
      </div>

      {allReports.some(r=>r.reportType === "chapter_digest") && <label className="muted"><input type="checkbox" checked={showDigests} onChange={e=>setShowDigests(e.target.checked)} /> 显示分块分析记录（{allReports.filter(r=>r.reportType === "chapter_digest").length} 条，可用于追溯和续跑）</label>}
      <Tabs
        tabs={[
          { id: "reports", label: `拆解报告 (${reports.length})` },
          { id: "text", label: "原文标注" },
          { id: "similar", label: "相似书" },
          { id: "swap", label: "换元工作台" },
          { id: "meta", label: "文档信息" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "reports" && (
        <div className="stack" style={{ marginTop: 12, gap: 12 }}>
          <Panel
            title={
              <span>
                报告目录
                <HelpIcon text="每种报告对应九格课里的一种拆解视角，点开即可阅读。" />
              </span>
            }
          >
            <div className="stack">
              <input
                className="input"
                placeholder="搜索报告标题 / 内容"
                value={reportQ}
                onChange={(e) => setReportQ(e.target.value)}
              />
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                  gap: 8,
                }}
              >
                {visibleReports.map((r) => {
                  const meta = getReportMeta(r.reportType, r.title);
                  return (
                    <HelpTip key={r.id} label={meta.purpose} side="top">
                      <button
                        type="button"
                        className="binder-item"
                        data-active={r.id === (activeReport?.id ?? reports[0]?.id)}
                        onClick={() => {
                          setReportId(r.id);
                          setShowRaw(false);
                        }}
                      >
                        <span style={{ flex: 1, textAlign: "left" }}>
                          <div>{meta.label}</div>
                          <div className="faint" style={{ fontSize: "var(--fs-xs)" }}>
                            {meta.purpose.slice(0, 28)}…
                          </div>
                        </span>
                        {runningReport ? <Badge>更新中</Badge> : <span className="faint">阅读</span>}
                      </button>
                    </HelpTip>
                  );
                })}
              </div>
              {!visibleReports.length && (
                <div className="empty">
                  {reportQ
                    ? "没有匹配的报告。"
                    : "还没有报告。点右上角「重新拆解分析」，系统会自动生成九类可读报告。"}
                </div>
              )}
            </div>
          </Panel>

          <Panel
            title={
              <span>
                {activeMeta?.label ?? "报告"}
                {activeMeta && <HelpIcon text={activeMeta.purpose} />}
              </span>
            }
            actions={
              <div className="row">
                {activeReport && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      const md = `# ${activeReport.title}\n\n${activeReport.bodyMarkdown}`;
                      const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `${activeReport.title || "report"}.md`;
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    导出报告
                  </Button>
                )}
                {activeReport && (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      toggleFav.mutate({
                        id: activeReport.id,
                        favorited: activeReport.favorited ?? false,
                      })
                    }
                  >
                    {activeReport.favorited ? "★ 已收藏" : "☆ 收藏"}
                  </Button>
                )}
                <HelpTip label="默认是阅读视图。仅在需要核对原文结构时再打开「原始稿」。">
                  <Button variant="ghost" onClick={() => setShowRaw((v) => !v)}>
                    {showRaw ? "返回阅读视图" : "查看原始稿"}
                  </Button>
                </HelpTip>
                <Button
                  variant="ghost"
                  disabled={!!runningReport || analyzeMut.isPending}
                  onClick={() => {
                    setError(null);
                    analyzeMut.mutate();
                  }}
                >
                  {runningReport ? "分析中…" : "再分析一次"}
                </Button>
              </div>
            }
          >
            {!showRaw && activeReport && (
              <ReportReader
                reportId={activeReport.id}
                reportType={activeReport.reportType}
                title={activeReport.title}
                bodyMarkdown={activeReport.bodyMarkdown}
                bodyJson={activeReport.bodyJson as Record<string, unknown> | null}
              />
            )}
            {!showRaw &&
              activeReport &&
              (activeReport.sourceFragments?.length ?? 0) > 0 && (
                <div className="stack" style={{ marginTop: 12 }}>
                  <div className="report-block__label">原文片段（点击跳转定位）</div>
                  <div className="stack" style={{ gap: 6 }}>
                    {(activeReport.sourceFragments ?? []).map((f, i) => (
                      <button
                        key={i}
                        type="button"
                        className="binder-item"
                        style={{ textAlign: "left" }}
                        onClick={() => {
                          const anchor = String(f.anchor ?? f.locator ?? "");
                          if (anchor) {
                            document
                              .getElementById(anchor)
                              ?.scrollIntoView({ behavior: "smooth", block: "start" });
                          }
                        }}
                      >
                        <span className="faint" style={{ fontSize: "var(--fs-2xs)" }}>
                          {String(f.locator ?? f.anchor ?? `片段 ${i + 1}`)}
                        </span>
                        <span style={{ flex: 1 }}>{String(f.text ?? f.summary ?? "")}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            {showRaw && activeReport && (
              <div className="stack">
                <HelpCallout title="原始稿说明" tone="warn">
                  以下是系统保存的原文格式，方便导出或排错。日常写作请用「阅读视图」。
                </HelpCallout>
                <div className="report-block">
                  <div className="report-block__label">可读正文稿</div>
                  <div className="report-block__value">{activeReport.bodyMarkdown || "（空）"}</div>
                </div>
                <div className="report-block">
                  <div className="report-block__label">结构化要点</div>
                  <pre
                    style={{
                      margin: 0,
                      whiteSpace: "pre-wrap",
                      fontFamily: "var(--font-ui)",
                      fontSize: 13,
                      lineHeight: 1.6,
                    }}
                  >
                    {formatJsonFriendly(activeReport.bodyJson)}
                  </pre>
                </div>
              </div>
            )}
            {!activeReport && <div className="empty">请从左侧选择一份报告。</div>}

            <div
              className="stack"
              style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 12 }}
            >
              <div className="report-block__label">
                应用到我的写作项目
                <HelpIcon text="不会改你已写好的正文，只是把参考作品的信息挂到项目上，方便创作台调用。" />
              </div>
              <div className="row" style={{ flexWrap: "wrap" }}>
                <Select
                  className="select"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  aria-label="选择项目"
                >
                  <option value="">选择要写入的项目…</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </Select>
                <HelpTip label={PUSH_HELP[pushMode]}>
                  <Select
                    className="select"
                    value={pushMode}
                    onChange={(e) => setPushMode(e.target.value as PushMode)}
                    aria-label="应用方式"
                  >
                    <option value="dissect">方式：带入拆解参数</option>
                    <option value="swap">方式：去做换元</option>
                    <option value="imitate">方式：去做仿写</option>
                  </Select>
                </HelpTip>
                <Button
                  variant="primary"
                  disabled={push.isPending || !projectId}
                  onClick={() => {
                    setError(null);
                    push.mutate(pushMode);
                  }}
                >
                  应用到写作台
                </Button>
              </div>
              <div className="faint" style={{ fontSize: "var(--fs-xs)" }}>
                {PUSH_HELP[pushMode]}
              </div>
            </div>
          </Panel>
        </div>
      )}

      {tab === "text" && (
        <Panel
          title="原文标注 · 重点旁注"
          actions={
            <span className="muted" style={{ fontSize: 12 }}>
              爽点绿 / 情绪蓝 / 钩子紫 / 付费红 / 节奏灰
            </span>
          }
        >
          <div className="stack" style={{ gap: 10 }}>
            {anchors.length > 0 && (
              <div className="stack" style={{ gap: 6 }}>
                <div className="muted" style={{ fontSize: 12 }}>
                  报告重点锚点 · 点击定位原文片段
                </div>
                <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                  {anchors.map((a) => {
                    const meta = KIND_META[a.kind];
                    const active = a.id === anchorSel;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        className="badge"
                        onClick={() => setAnchorSel(active ? null : a.id)}
                        style={{
                          borderColor: meta.color,
                          color: meta.color,
                          cursor: "pointer",
                          opacity: anchorSel && !active ? 0.45 : 1,
                        }}
                      >
                        {a.label}
                      </button>
                    );
                  })}
                </div>
                {anchorHit && (
                  <div className="help-callout" style={{ margin: 0 }}>
                    <div className="help-callout__title">
                      {anchorHit.found ? "原文定位" : "未在原文中找到"}
                    </div>
                    <div className="help-callout__body">
                      {anchorHit.found
                        ? `…${anchorHit.context}…`
                        : "该重点来自报告摘要，原文无此关键词。"}
                    </div>
                  </div>
                )}
              </div>
            )}
            {docText?.text ? (
              <ManuscriptAnnotatedView
                text={docText.text}
                format={formatFromDocType(doc?.docType)}
                anchors={[]}
                referenceSource={{kind:"kb_doc",sourceId:id,title:doc?.title}}
              />
            ) : (
              <div className="empty">暂无原文可标注（文档可能还在解析，或未上传正文）。</div>
            )}
          </div>
        </Panel>
      )}

      {tab === "similar" && (
        <Panel title="相似书 · 故事指纹" actions={<Badge tone="ok">{similar?.items.length ?? 0} 本</Badge>}>
          {!similar?.items.length ? (
            <div className="empty">
              {similar?.hint || "暂无相似书。拆解完成后会按核心梗/题材/金手指/情绪曲线计算相似度。"}
            </div>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                按故事指纹相似度排序，可作「同梗复用 / 换元对标」参考。
              </p>
              {similar.items.map((it) => (
                <div key={it.doc_id} className="row" style={{ gap: 8, alignItems: "center" }}>
                  <Badge tone={it.score >= 0.5 ? "ok" : it.score >= 0.3 ? "warn" : "default"}>
                    相似 {Math.round(it.score * 100)}%
                  </Badge>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{it.title}</span>
                  {it.same_genre ? <Badge>同题材</Badge> : null}
                  {it.same_hook ? <Badge>同梗类</Badge> : null}
                  {it.shared_tags.length > 0 && (
                    <span className="muted" style={{ fontSize: 11 }}>
                      共桥段：{it.shared_tags.join("、")}
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void nav({ to: "/kb/docs/$id", params: { id: it.doc_id } })}
                  >
                    查看
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}

      {tab === "swap" && (
        <>
          <HelpCallout title="换元怎么点" tone="tip" collapsible defaultOpen={false}>
            按六大元素映射（事件/结构/主体/背景/人物/道具）。一度不换核心事件；二度必须换。相似度≥0.72
            阻断推送。推送后到写作台走换元七步（情绪上下行、写一章改一章、质检 P1→P3）。
          </HelpCallout>
          <SwapWorkspace docId={id} projectId={projectId || undefined} />
        </>
      )}

      {tab === "meta" && (
        <div className="stack" style={{ marginTop: 12 }}>
          <Panel title="文档信息">
            <HelpCallout tone="info">
              这些是文件来源信息，方便你区分多本参考作品。日常写作不必改这里。
            </HelpCallout>
            <div className="grid grid-2">
              <div className="field">
                <label>
                  作者
                  <HelpIcon text="参考作品署名，可为空。" />
                </label>
                <input className="input" readOnly value={doc.author ?? "未知"} />
              </div>
              <div className="field">
                <label>
                  来源
                  <HelpIcon text="你从哪里导入的（上传 / 粘贴等）。" />
                </label>
                <input className="input" readOnly value={doc.source ?? "—"} />
              </div>
              <div className="field">
                <label>字数</label>
                <input className="input" readOnly value={String(doc.wordCount ?? 0)} />
              </div>
              <div className="field">
                <label>状态</label>
                <input className="input" readOnly value={STATUS_LABEL[doc.status] ?? doc.status} />
              </div>
            </div>
          </Panel>

          <Panel title="已应用到项目（可撤销）">
            {bindings.length === 0 ? (
              <div className="empty">还没有应用到任何项目。</div>
            ) : (
              <div className="stack">
                {bindings.map((b) => {
                  const proj = projects.find((p) => p.id === b.projectId);
                  return (
                    <div key={b.id} className="agent-task-row">
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: "var(--fs-sm)" }}>
                          {proj?.title ?? b.projectId.slice(0, 8)}
                        </div>
                        <div className="faint" style={{ fontSize: "var(--fs-2xs)" }}>
                          {b.mode || b.targetType} · {new Date(b.createdAt).toLocaleString("zh-CN")}
                        </div>
                      </div>
                      <Button size="sm" variant="danger" onClick={() => revokeMut.mutate(b.id)}>
                        撤销
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>
      )}

      <ConfirmDialog
        open={confirmDel}
        title="确定删除这份参考作品？"
        description="相关拆解报告和人物关系也会一并清掉，无法恢复。"
        danger
        confirmLabel="删除"
        onOpenChange={setConfirmDel}
        onConfirm={() => deleteMut.mutate()}
      />
    </div>
  );
}

function formatJsonFriendly(data: unknown, indent = 0): string {
  if (data == null) return "（无结构化要点）";
  const pad = "  ".repeat(indent);
  if (typeof data !== "object") return String(data);
  if (Array.isArray(data)) {
    if (!data.length) return "（空列表）";
    return data
      .map((item, i) => `${pad}${i + 1}. ${formatJsonFriendly(item, indent + 1).trimStart()}`)
      .join("\n");
  }
  return Object.entries(data as Record<string, unknown>)
    .map(([k, v]) => {
      const label = fieldLabel(k);
      if (v != null && typeof v === "object") {
        return `${pad}${label}：\n${formatJsonFriendly(v, indent + 1)}`;
      }
      return `${pad}${label}：${v == null ? "—" : String(v)}`;
    })
    .join("\n");
}
