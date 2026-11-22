import {
  SIX_ELEMENT_KEYS,
  SIX_ELEMENT_LABELS,
  defaultSixElementsMapping,
  sixElementsCompleteness,
  type SixElementKey,
} from "@xiezuomanju/domain";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Badge, Button, DiffCompare, Panel, StreamPanel, Tabs } from "@xiezuomanju/ui";
import { Select } from "@xiezuomanju/ui";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { runAgentFeedback } from "../studio/runAgentFeedback";

type Row = {
  key: SixElementKey;
  label: string;
  source: string;
  target: string;
  swappable: boolean;
  sourceDocTitle?: string | null;
};

function emptyRows(degree: "once" | "twice"): Row[] {
  const m = defaultSixElementsMapping(degree);
  return m.rows.map((r) => ({
    key: r.key,
    label: SIX_ELEMENT_LABELS[r.key],
    source: r.source,
    target: r.target,
    swappable: r.swappable,
  }));
}

function rowsFromDissect(
  params: Record<string, unknown> | null | undefined,
  degree: "once" | "twice",
): Row[] {
  const base = emptyRows(degree);
  if (!params) return base;
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = params[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  };
  const setting =
    (params.setting as Record<string, unknown> | undefined) ||
    (params.params as Record<string, unknown> | undefined) ||
    params;
  const map: Partial<Record<SixElementKey, string>> = {
    character: pick("protagonist", "主角", "main_character") ||
      (typeof setting.protagonist === "string" ? setting.protagonist : ""),
    background:
      pick("setting", "world", "场景", "时代", "background") ||
      (typeof setting.background === "string" ? setting.background : ""),
    prop: pick("gold_finger", "goldfinger", "金手指", "power_system", "prop"),
    event: pick("conflict", "main_conflict", "核心冲突", "goal", "coreContent", "synopsis"),
    structure: pick("rhythm", "structure", "节奏", "叙事视角"),
    subject: pick("subject", "价值观", "theme", "genre", "题材"),
  };
  return base.map((r) => ({
    ...r,
    source: map[r.key] || r.source,
  }));
}

/** 换元工作台：六大元素 + 一度/二度 + 相似度红线 + 推送到写作台（与 Studio 共用语义）。 */
export function SwapWorkspace({
  docId,
  projectId: projectIdProp,
}: {
  docId: string;
  projectId?: string;
}) {
  const nav = useNavigate();
  const [degree, setDegree] = useState<"first" | "second">("first");
  const degreeKey = degree === "second" ? "twice" : "once";
  const [rows, setRows] = useState<Row[]>(() => emptyRows("once"));
  const [projectId, setProjectId] = useState(projectIdProp ?? "");
  const [streamText, setStreamText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [simScore, setSimScore] = useState<number | null>(null);
  const [simMsg, setSimMsg] = useState<string | null>(null);
  const [sourceBlurb, setSourceBlurb] = useState(
    "（从拆书参数加载原作摘要；无报告时请手填六元素源列）",
  );
  const [skinOnlyRisk, setSkinOnlyRisk] = useState(false);
  const [comboIds, setComboIds] = useState<string[]>([]);
  const [composeSummary, setComposeSummary] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects(),
  });
  const { data: reports = [] } = useQuery({
    queryKey: ["kb-reports", docId],
    queryFn: () => api.listReports(docId),
    enabled: !!docId,
  });
  const { data: similar } = useQuery({
    queryKey: ["kb-similar", docId],
    queryFn: () => api.similarDocs(docId),
    enabled: !!docId,
  });

  useEffect(() => {
    if (projectIdProp) setProjectId(projectIdProp);
    else if (!projectId && projects[0]?.id) setProjectId(projects[0].id);
  }, [projectIdProp, projects, projectId]);

  useEffect(() => {
    const dissect =
      reports.find((r) => r.reportType === "dissect_params") ||
      reports.find((r) => r.reportType === "core_hook_extract") ||
      reports.find((r) => r.reportType === "core_hook");
    if (!dissect) {
      setRows(emptyRows(degreeKey));
      return;
    }
    const body = (dissect.bodyJson ?? {}) as Record<string, unknown>;
    const nested =
      (body.params as Record<string, unknown> | undefined) ||
      (body.findings as Record<string, unknown> | undefined) ||
      body;
    setRows(rowsFromDissect(nested, degreeKey));
    const summary =
      (typeof body.summary === "string" && body.summary) ||
      (typeof dissect.bodyMarkdown === "string" && dissect.bodyMarkdown.slice(0, 280)) ||
      "";
    if (summary) setSourceBlurb(summary);
  }, [reports, degreeKey]);

  const mappingScore = sixElementsCompleteness({
    degree: degreeKey,
    rows: rows.map((r) => ({
      key: r.key,
      source: r.source,
      target: r.target,
      swappable: r.swappable,
      note: "",
    })),
    skinOnlyRisk,
  });

  const update = (key: SixElementKey, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const onDegreeChange = (id: string) => {
    const next = id === "second" ? "second" : "first";
    setDegree(next);
    const dk = next === "second" ? "twice" : "once";
    setRows((prev) => {
      const fresh = emptyRows(dk);
      return fresh.map((f) => {
        const old = prev.find((p) => p.key === f.key);
        return old
          ? {
              ...f,
              source: old.source,
              target: dk === "once" && f.key === "event" ? "" : old.target,
            }
          : f;
      });
    });
  };

  const startGenerate = async () => {
    if (!projectId) {
      setError("请先选择目标项目");
      return;
    }
    setError(null);
    setStreaming(true);
    setStreamText("");
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      await api.createSwapPlan({
        projectId,
        sourceDocId: docId,
        degree: degree === "second" ? "two" : "one",
        mappingJson: rows.map((r) => ({
          key: r.key,
          label: r.label,
          source: r.source,
          target: r.target,
          swappable: r.swappable,
        })),
      });

      await runAgentFeedback(projectId, "swap.master", {
        quiet: true,
        signal: ac.signal,
        label: "换元生成",
        inputJson: {
          docId,
          degree: degree === "second" ? "two" : "one",
          mapping: rows,
          sixElements: SIX_ELEMENT_KEYS,
          comboDocs: similar?.items
            .filter((it) => comboIds.includes(it.doc_id))
            .map((it) => ({ docId: it.doc_id, title: it.title, score: it.score })),
        },
        onEvent: (ev) => {
          const token =
            (typeof ev.token === "string" && ev.token) ||
            (typeof ev.text === "string" && ev.text) ||
            (typeof ev.message === "string" && ev.type !== "status" && ev.type !== "done"
              ? ev.message
              : "");
          if (token) setStreamText((t) => t + token);
          if (ev.type === "done" || ev.status === "succeeded") {
            setStreamText((t) =>
              t ||
              rows.map((r) => `${r.label}：${r.source} → ${r.target}`).join("\n") +
                "\n\n（换元计划已保存；AI 的结果会实时显示在这里。）",
            );
          }
          if (ev.type === "error") {
            setError(String(ev.message ?? "生成失败"));
          }
        },
      });
    } catch (e) {
      if (!ac.signal.aborted) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setStreaming(false);
    }
  };

  const autoCompose = async () => {
    if (!docId) {
      setError("缺少基准文档");
      return;
    }
    setError(null);
    try {
      const res = await api.composeSwap(docId, {
        comboDocIds: comboIds,
        degree: degree === "second" ? "two" : "one",
        projectId: projectId || undefined,
      });
      setRows(
        res.mapping.map((m) => ({
          key: m.key as SixElementKey,
          label: m.label,
          source: m.source,
          target: m.target,
          swappable: m.swappable,
          sourceDocTitle: m.sourceDocTitle,
        })),
      );
      const used = res.sources
        .filter((s) => s.usedFor.length)
        .map((s) => `${s.title}(${s.usedFor.join("、")})`);
      setComposeSummary(
        used.length
          ? `已自动拆解来源：${used.join("；")}；其余沿用基准书。`
          : "未找到可用的组合来源元素，建议先对来源书完成拆解分析。",
      );
      setSourceBlurb(res.base.title);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const abort = () => {
    abortRef.current?.abort();
    setStreaming(false);
  };

  const estimateSimilarity = () => {
    let overlap = 0;
    let total = 0;
    for (const r of rows) {
      if (!r.swappable) continue;
      const s = r.source.replace(/\s/g, "");
      const t = r.target.replace(/\s/g, "");
      if (!s || !t) continue;
      total += 1;
      const shared = [...s].filter((ch) => t.includes(ch)).length;
      overlap += shared / Math.max(s.length, t.length);
    }
    const score = total ? Math.min(0.99, overlap / total) : 0.5;
    setSimScore(Number(score.toFixed(2)));
    if (score >= 0.72) {
      setSimMsg(`相似度约 ${score.toFixed(2)} ≥ 0.72：洗稿风险过高，请加大换元幅度后再推送`);
    } else if (score >= 0.6) {
      setSimMsg(`相似度约 ${score.toFixed(2)} 偏高：注意微创新，建议再拉开人物/事件`);
    } else {
      setSimMsg(`相似度约 ${score.toFixed(2)}：可接受区间（仍须人工审）`);
    }
    return score;
  };

  const push = async () => {
    if (!projectId) {
      setError("请先选择目标项目");
      return;
    }
    setError(null);
    const score = simScore ?? estimateSimilarity();
    if (score >= 0.72) {
      setError(simMsg || "相似度过高，已阻断推送");
      return;
    }
    try {
      if (projectId) {
        void runAgentFeedback(projectId, "qc.similarity", {
          label: "qc.similarity",
          inputJson: { score, degree, mapping: rows },
        });
      }
      await api.createSwapPlan({
        projectId,
        sourceDocId: docId,
        degree: degree === "second" ? "two" : "one",
        mappingJson: rows.map((r) => ({
          key: r.key,
          label: r.label,
          source: r.source,
          target: r.target,
          swappable: r.swappable,
        })),
      });
      const res = await api.pushToProject(docId, projectId, "swap");
      nav({ to: "/projects/$id", params: { id: res.projectId } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="stack">
      {similar?.items?.length ? (
        <Panel title="相似书 · 组合复用参考" style={{ marginBottom: 0 }}>
          <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
            想组合「A 的核心梗 + B 的单元结构 + C 的金手指」？先看这些相似书，再回映射表手动填入对应元素。
          </p>
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {similar.items.slice(0, 6).map((it) => (
              <span key={it.doc_id} className="row" style={{ gap: 6, alignItems: "center" }}>
                <Badge tone={it.score >= 0.5 ? "ok" : "default"}>
                  相似 {Math.round(it.score * 100)}%
                </Badge>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{it.title}</span>
                {it.same_genre ? <Badge>同题材</Badge> : null}
                {it.same_hook ? <Badge>同梗类</Badge> : null}
                {(it.reasons ?? []).slice(0, 2).map((r) => (
                  <span key={r} className="faint" style={{ fontSize: 11 }}>
                    {r}
                  </span>
                ))}
                <label className="row" style={{ gap: 4, fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={comboIds.includes(it.doc_id)}
                    onChange={() =>
                      setComboIds((prev) =>
                        prev.includes(it.doc_id)
                          ? prev.filter((x) => x !== it.doc_id)
                          : prev.length >= 3
                            ? prev
                            : [...prev, it.doc_id],
                      )
                    }
                  />
                  加入组合
                </label>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void nav({ to: "/kb/docs/$id", params: { id: it.doc_id } })
                  }
                >
                  查看拆解
                </Button>
              </span>
            ))}
          </div>
        </Panel>
      ) : null}
      <Panel
        title="换元映射表（六大元素）"
        actions={
          <Tabs
            tabs={[
              { id: "first", label: "一度换元" },
              { id: "second", label: "二度换元" },
            ]}
            value={degree}
            onChange={onDegreeChange}
          />
        }
      >
        <div className="row" style={{ marginBottom: 10 }}>
          <label className="row" style={{ gap: 8 }}>
            <span className="muted">目标项目</span>
            <Select
              className="select"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">选择项目…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </Select>
          </label>
        </div>
        {error && <Badge tone="fail">{error}</Badge>}
        <p className="muted" style={{ marginTop: 0 }}>
          {degree === "first"
            ? "一度换元：换背景 / 人物 / 道具，核心事件与结构骨架尽量保留。"
            : "二度换元：必须替换核心事件；背景/人物等随事件调整；主体（价值观）通常少换。"}
        </p>
        <div className="row" style={{ gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <Badge>
            映射 {mappingScore.filled}/{mappingScore.total}
          </Badge>
          {mappingScore.degreeConflict && (
            <Badge tone="fail">一度/二度与事件置换冲突</Badge>
          )}
          <Button
            size="sm"
            variant={comboIds.length ? "primary" : "ghost"}
            disabled={!comboIds.length}
            onClick={() => void autoCompose()}
          >
            自动组合生成方案
          </Button>
        </div>
        {composeSummary ? (
          <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
            {composeSummary}
          </p>
        ) : null}
        <table className="table">
          <thead>
            <tr>
              <th>六元素</th>
              <th>原作</th>
              <th>置换为</th>
              <th>可换</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td style={{ fontWeight: 600 }}>
                  {r.label}
                  {r.sourceDocTitle && (
                    <span className="faint" style={{ display: "block", fontSize: 10 }}>
                      来源 · {r.sourceDocTitle}
                    </span>
                  )}
                </td>
                <td>
                  <input
                    className="input"
                    value={r.source}
                    placeholder="原作元素"
                    onChange={(e) => update(r.key, { source: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="input"
                    value={r.target}
                    disabled={!r.swappable}
                    placeholder={r.swappable ? "置换为" : "本度不换"}
                    onChange={(e) => update(r.key, { target: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={r.swappable}
                    onChange={(e) => update(r.key, { swappable: e.target.checked })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <label className="row" style={{ gap: 6, marginTop: 8 }}>
          <input
            type="checkbox"
            checked={skinOnlyRisk}
            onChange={(e) => setSkinOnlyRisk(e.target.checked)}
          />
          <span style={{ fontSize: 12 }}>自检：是否换皮不换骨</span>
        </label>
        <div className="row" style={{ marginTop: 10, flexWrap: "wrap", gap: 8 }}>
          <Badge>保留：情绪峰值（上下行对照在写作台）</Badge>
          <Badge tone={simScore != null && simScore >= 0.72 ? "fail" : "warn"}>
            {simMsg || "置换后需过相似度红线 ≥0.72 阻断"}
          </Badge>
          <Button size="sm" onClick={() => estimateSimilarity()}>
            估算相似度
          </Button>
        </div>
      </Panel>

      <DiffCompare
        leftTitle="对标原作"
        rightTitle="换元稿预览"
        left={<pre className="prose-block">{sourceBlurb}</pre>}
        right={
          <pre className="prose-block">
            {streamText || "点「生成换元稿」，AI 会根据对标结构写一版。"}
          </pre>
        }
      />

      <StreamPanel
        text={streamText}
        streaming={streaming}
        onStart={() => void startGenerate()}
        onAbort={abort}
      />

      <div className="row">
        <Button variant="primary" onClick={() => void push()}>
          推送到写作台（换元）
        </Button>
        <span className="muted">生成 swap_plan 交稿物；六元素与 Studio 换元七步语义一致。</span>
      </div>
    </div>
  );
}
