import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MemoryMeta } from "@xiezuomanju/domain";
import {
  Badge,
  Button,
  CollapsibleSection,
  DiffCompare,
  HelpIcon,
  HelpTip,
  PageHeader,
  Panel,
  Tabs,
  toast,
} from "@xiezuomanju/ui";
import { Select } from "@xiezuomanju/ui";
import {
  Archive,
  BookOpen,
  FolderOpen,
  History,
  Lock,
  Search,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import { runAgentFeedback } from "../studio/runAgentFeedback";
import { DreamsPanel } from "./DreamsPanel";

/** L1–L5 → 热/温/冷产品分层（对齐 docs/architecture/01-memory-system.md） */
export type MemoryTier = "hot" | "warm" | "cold";

export function classifyMemoryTier(path: string, updatedAt: string): MemoryTier {
  const p = path.toLowerCase();
  const ageDays = (Date.now() - new Date(updatedAt).getTime()) / 86_400_000;

  // 冷：receipts、旧 journal、归档目录
  if (
    p.includes("/receipts/") ||
    p.includes("/archive/") ||
    p.includes("/cold/") ||
    (p.includes("/journal/") && ageDays > 14)
  ) {
    return "cold";
  }
  // 热：当前项目决策/人设/世界/PROJECT、当日 journal、USER 偏好
  if (
    p.endsWith("/project.md") ||
    p.endsWith("/decisions.md") ||
    p.endsWith("/characters.md") ||
    p.endsWith("/world.md") ||
    p.includes("/user/") ||
    p.includes("/bible") ||
    (p.includes("/journal/") && ageDays <= 2) ||
    p.includes("/handoffs/")
  ) {
    return "hot";
  }
  // 温：hypothesis、近期 journal、其余项目文件
  return "warm";
}

function confidenceTone(c: number | null | undefined): "ok" | "warn" | "fail" {
  const v = typeof c === "number" ? c : 0.5;
  if (v >= 0.7) return "ok";
  if (v >= 0.3) return "warn";
  return "fail";
}

const TIER_META: Record<
  MemoryTier,
  { label: string; hint: string; tone: "ok" | "warn" | "default" }
> = {
  hot: {
    label: "常用",
    hint: "写正文时会自动带上：人物、设定、已定决策",
    tone: "ok",
  },
  warm: {
    label: "备用",
    hint: "需要时才会用到：近期摘要、待验证想法",
    tone: "warn",
  },
  cold: {
    label: "存档",
    hint: "很久没用到的旧记录，搜索时仍能找到",
    tone: "default",
  },
};

const TEMPLATES: { path: string; label: string; body: string }[] = [
  {
    path: "/memories/user/preferences.md",
    label: "用户偏好",
    body: "# 偏好\n- 主攻频向：\n- 禁忌：\n- 口味：\n",
  },
  {
    path: "/memories/projects/{id}/decisions.md",
    label: "项目决策",
    body: "# 已采纳决策\n- 核心梗：\n- 金手指上限：\n",
  },
  {
    path: "/memories/projects/{id}/characters.md",
    label: "人物设定",
    body: "# 人物设定\n## 主角\n- 目标：\n- 弱点：\n",
  },
  {
    path: "/memories/projects/{id}/journal/ch-001.md",
    label: "章节摘要",
    body: "# 第 1 章摘要\n## 发生了什么\n\n## 还没收的伏笔\n",
  },
];

export function MemoryPage() {
  const qc = useQueryClient();
  const [mainTab, setMainTab] = useState<"files" | "dreams" | "stores">("files");
  const [tier, setTier] = useState<MemoryTier | "all">("hot");
  const [q, setQ] = useState("");
  const [path, setPath] = useState("");
  const [content, setContent] = useState("");
  const [loadedHash, setLoadedHash] = useState<string | null>(null);
  const [newPath, setNewPath] = useState("/memories/projects/");
  const [coldPreview, setColdPreview] = useState<MemoryMeta[]>([]);
  const [dreamProjectId, setDreamProjectId] = useState("");
  const [storeFilter, setStoreFilter] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [diffVersionId, setDiffVersionId] = useState<string | null>(null);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects({}),
  });
  const dreamPid = dreamProjectId || projects[0]?.id || "";

  const { data: stores = [] } = useQuery({
    queryKey: ["memory-stores", dreamPid],
    queryFn: () => api.listMemoryStores(dreamPid || undefined),
  });

  const { data: tree = [], isLoading } = useQuery({
    queryKey: ["memory", storeFilter, dreamPid],
    queryFn: () =>
      api.memoryTree({
        storeId: storeFilter || undefined,
        projectId: dreamPid || undefined,
      }),
  });

  const enriched = useMemo(
    () =>
      tree.map((m) => ({
        ...m,
        tier: classifyMemoryTier(m.path, m.updatedAt),
      })),
    [tree],
  );

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return enriched.filter((m) => {
      if (tier !== "all" && m.tier !== tier) return false;
      if (!ql) return true;
      return (
        m.path.toLowerCase().includes(ql) ||
        (m.content ?? "").toLowerCase().includes(ql) ||
        (m.actor || "").toLowerCase().includes(ql) ||
        (m.storeId || "").toLowerCase().includes(ql)
      );
    });
  }, [enriched, tier, q]);

  const counts = useMemo(() => {
    const c = { hot: 0, warm: 0, cold: 0, all: enriched.length };
    for (const m of enriched) c[m.tier] += 1;
    return c;
  }, [enriched]);

  useEffect(() => {
    if (!path && filtered[0]) setPath(filtered[0].path);
  }, [filtered, path]);

  const { data: file } = useQuery({
    queryKey: ["memory-file", path],
    queryFn: () => api.getMemory(path),
    enabled: !!path,
  });

  useEffect(() => {
    if (file) {
      setContent(file.content ?? "");
      setLoadedHash(file.hash ?? null);
    }
  }, [file]);

  const save = useMutation({
    mutationFn: () =>
      api.putMemory(path, content, {
        expectedHash: loadedHash,
        checkCas: true,
        projectId: dreamPid || undefined,
        changeSummary: "ui save",
      }),
    onSuccess: (row) => {
      setLoadedHash(row.hash ?? null);
      qc.invalidateQueries({ queryKey: ["memory"] });
      qc.invalidateQueries({ queryKey: ["memory-file", path] });
      toast.ok("记忆已保存（CAS）");
    },
    onError: (e: Error) => {
      const msg = e.message || "保存失败";
      if (msg.includes("memory_conflict") || msg.includes("409")) {
        toast.fail("并发冲突：其他写入已更新此文件，请刷新后再保存");
        qc.invalidateQueries({ queryKey: ["memory-file", path] });
      } else {
        toast.fail(msg);
      }
    },
  });

  const freeze = useMutation({
    mutationFn: () => api.freezeMemory(path),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["memory"] });
      qc.invalidateQueries({ queryKey: ["memory-file", path] });
      toast.ok("已锁定，之后只能查看");
    },
  });

  const remove = useMutation({
    mutationFn: () => api.deleteMemory(path),
    onSuccess: () => {
      setPath("");
      setContent("");
      qc.invalidateQueries({ queryKey: ["memory"] });
      toast.ok("已删除");
    },
    onError: (e: Error) => toast.fail(e.message),
  });

  const createFile = useMutation({
    mutationFn: async () => {
      const p = newPath.trim();
      if (!p.startsWith("/memories")) throw new Error("路径须以 /memories 开头");
      return api.putMemory(p, `# ${p.split("/").pop()}\n\n`);
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["memory"] });
      setPath(row.path);
      setTier("all");
      toast.ok("已新建记忆");
    },
    onError: (e: Error) => toast.fail(e.message),
  });

  const searchRemote = useMutation({
    mutationFn: () => api.searchMemory(q),
    onSuccess: (rows) => {
      if (!rows.length) {
        toast.info("没有找到相关记忆");
        return;
      }
      setPath(rows[0]!.path);
      setTier("all");
      toast.ok(`找到 ${rows.length} 条，已打开第一条`);
    },
  });

  const { data: versions = [] } = useQuery({
    queryKey: ["memory-versions", path],
    queryFn: () => api.memoryVersions(path),
    enabled: showHistory && !!path,
  });

  const snap = useMutation({
    mutationFn: () => api.snapshotMemory(path),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["memory-versions", path] });
      toast.ok("已保存快照");
    },
    onError: (e: Error) => toast.fail(e.message),
  });

  const rollback = useMutation({
    mutationFn: (versionId: string) => api.rollbackMemory(versionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["memory"] });
      qc.invalidateQueries({ queryKey: ["memory-file", path] });
      qc.invalidateQueries({ queryKey: ["memory-versions", path] });
      toast.ok("已回滚");
    },
    onError: (e: Error) => toast.fail(e.message),
  });

  const scanCold = () => {
    const candidates = enriched.filter((m) => m.tier === "cold" && !m.frozen);
    setColdPreview(candidates);
    if (!candidates.length) toast.info("暂时没有需要收起的旧记录");
  };

  const archiveCold = useMutation({
    mutationFn: async () => {
      const moved: string[] = [];
      for (const m of coldPreview) {
        if (m.path.includes("/archive/")) continue;
        const dest = m.path.replace("/memories/", "/memories/archive/");
        await api.putMemory(dest, m.content ?? "");
        await api.freezeMemory(dest);
        try {
          await api.deleteMemory(m.path);
        } catch {
          /* 源文件可能已不存在 */
        }
        moved.push(dest);
      }
      return moved;
    },
    onSuccess: (moved) => {
      setColdPreview([]);
      qc.invalidateQueries({ queryKey: ["memory"] });
      toast.ok(`已收起并锁定 ${moved.length} 条旧记录`);
    },
    onError: (e: Error) => toast.fail(e.message),
  });

  const currentTier = path ? classifyMemoryTier(path, file?.updatedAt ?? new Date().toISOString()) : null;

  return (
    <div className="page page--wide">
      <PageHeader
        title="写作记忆"
        description="保存人物、设定和每次写作的要点。常用的放在手边，久不用的收进档案，之后仍能搜到。"
        actions={
          <div className="row" style={{ gap: 6 }}>
            <HelpTip label="帮你找出很久没用到的旧记录。不会删除，只是准备收进档案。">
              <Button size="sm" onClick={scanCold}>
                <Search size={14} />
                查找可收起的记录
              </Button>
            </HelpTip>
            <HelpTip label="把旧记录移入档案并锁定，之后仍可查看和搜索，不会被误改。">
              <Button
                size="sm"
                variant="primary"
                disabled={!coldPreview.length || archiveCold.isPending}
                onClick={() => archiveCold.mutate()}
              >
                <Archive size={14} />
                收起旧记录（{coldPreview.length}）
              </Button>
            </HelpTip>
          </div>
        }
      />

      <Panel
        title={
          <span>
            项目与记忆库
            <HelpIcon text="共享库（项目圣经/用户偏好）与独立库（Agent lessons / 会话 scratch）分开挂载；Dreaming 提案需人工确认后合入。" />
          </span>
        }
        style={{ marginTop: 12 }}
      >
        <div className="row" style={{ flexWrap: "wrap", gap: 8, alignItems: "end" }}>
          <label className="field" style={{ minWidth: 200 }}>
            <span>项目</span>
            <Select
              className="select"
              value={dreamProjectId}
              onChange={(e) => { setDreamProjectId(e.target.value); setStoreFilter(""); setPath(""); }}
            >
              <option value="">（默认最近项目）</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </Select>
          </label>
          <label className="field" style={{ minWidth: 240 }}>
            <span>Memory Store</span>
            <Select
              className="select"
              value={storeFilter}
              onChange={(e) => { setStoreFilter(e.target.value); setPath(""); }}
            >
              <option value="">全部库</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.shared ? "共享" : "独立"} · {s.name}
                </option>
              ))}
            </Select>
          </label>
          <Button
            disabled={!dreamPid}
            onClick={() =>
              void runAgentFeedback(dreamPid, "harness.refine", {
                label: "总结最近经验",
                inputJson: { focus: path || "recent_runs" },
              }).then(() => qc.invalidateQueries({ queryKey: ["memory"] }))
            }
          >
            <BookOpen size={14} />
            总结最近经验（Refine 提案）
          </Button>
          <Button
            disabled={!dreamPid}
            onClick={() =>
              void runAgentFeedback(dreamPid, "harness.check_critic", {
                label: "质检批判",
                inputJson: {},
              }).then(() => qc.invalidateQueries({ queryKey: ["memory"] }))
            }
          >
            <Search size={14} />
            质检批判（补 check）
          </Button>
          <Button
            variant="primary"
            disabled={!dreamPid}
            onClick={() => setMainTab("dreams")}
          >
            <Sparkles size={14} />
            打开 Dreaming
          </Button>
        </div>
        <Tabs
          tabs={[
            { id: "files", label: "文件与归属" },
            { id: "dreams", label: "Dreaming Diff" },
            { id: "stores", label: `Stores(${stores.length})` },
          ]}
          value={mainTab}
          onChange={(id) => setMainTab(id as typeof mainTab)}
        />
      </Panel>

      {mainTab === "dreams" && (
        <div style={{ marginTop: 12 }}>
          <DreamsPanel key={`${dreamPid}/${storeFilter}`} projectId={dreamPid || undefined} storeId={storeFilter || undefined} />
        </div>
      )}

      {mainTab === "stores" && (
        <Panel title="Memory Stores（共享 vs 独立）" style={{ marginTop: 12 }}>
          <div className="stack" style={{ gap: 8 }}>
            {stores.map((s) => (
              <div
                key={s.id}
                className="row"
                style={{
                  gap: 8,
                  padding: "8px 0",
                  borderBottom: "1px solid var(--border)",
                  cursor: "pointer",
                }}
                onClick={() => {
                  setStoreFilter(s.id);
                  setPath("");
                  setMainTab("files");
                }}
              >
                <Badge tone={s.shared ? "ok" : "warn"}>{s.shared ? "共享" : "独立"}</Badge>
                <Badge>{s.kind}</Badge>
                <strong style={{ fontSize: 13 }}>{s.name}</strong>
                <span className="faint" style={{ fontSize: 11 }}>
                  {s.id}
                </span>
                <span className="faint" style={{ fontSize: 11, marginLeft: "auto" }}>
                  {s.description || "—"}
                </span>
              </div>
            ))}
            {!stores.length && <p className="faint">选择项目后将自动确保默认 Store。</p>}
          </div>
        </Panel>
      )}

      {mainTab === "files" && (
        <>

      <div className="kpi-row" style={{ marginTop: 12 }}>
        {(["hot", "warm", "cold"] as const).map((t) => {
          const Icon = t === "hot" ? BookOpen : t === "warm" ? FolderOpen : Archive;
          return (
            <button
              key={t}
              type="button"
              className="kpi"
              title={TIER_META[t].hint}
              style={{
                cursor: "pointer",
                textAlign: "left",
                borderColor: tier === t ? "var(--accent)" : undefined,
              }}
              onClick={() => setTier(t)}
            >
              <div className="row" style={{ justifyContent: "space-between", gap: 6 }}>
                <div className="kpi__value">{counts[t]}</div>
                <Icon size={17} style={{ color: "var(--faint)" }} />
              </div>
              <div className="kpi__label">{TIER_META[t].label}记忆</div>
              <div className="faint" style={{ marginTop: 4, fontSize: 10.5, lineHeight: 1.4 }}>
                {TIER_META[t].hint}
              </div>
            </button>
          );
        })}
        <button
          type="button"
          className="kpi"
          style={{ cursor: "pointer", textAlign: "left" }}
          onClick={() => setTier("all")}
        >
          <div className="kpi__value">{counts.all}</div>
          <div className="kpi__label">全部记忆</div>
        </button>
      </div>

      <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
        <input
          className="input"
          style={{ flex: 1, minWidth: 200 }}
          placeholder="搜索记忆内容，例如「主角目标」…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") searchRemote.mutate();
          }}
        />
        <Button onClick={() => searchRemote.mutate()} disabled={searchRemote.isPending}>
          <Search size={14} />
          搜索记忆
        </Button>
        <Tabs
          tabs={[
            { id: "all", label: `全部(${counts.all})` },
            { id: "hot", label: `常用(${counts.hot})` },
            { id: "warm", label: `备用(${counts.warm})` },
            { id: "cold", label: `存档(${counts.cold})` },
          ]}
          value={tier}
          onChange={(id) => setTier(id as MemoryTier | "all")}
        />
      </div>

      {coldPreview.length > 0 && (
        <Panel title="准备收起的记录" style={{ marginTop: 12 }}>
          <p className="muted" style={{ marginTop: 0 }}>
            这些记录会移入档案并锁定，之后仍能查看和搜索；常用与备用记忆不会受影响。
          </p>
          <ul className="memory-cold-preview" style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {coldPreview.map((m) => (
              <li key={m.path} title={m.path}>
                {m.path.split("/").pop() || m.path}
              </li>
            ))}
          </ul>
          <Button size="sm" style={{ marginTop: 8 }} onClick={() => setColdPreview([])}>
            先不收
          </Button>
        </Panel>
      )}

      <div className="split" style={{ height: "auto", minHeight: 480, marginTop: 12 }}>
        <Panel
          title="我的记忆"
          actions={<Badge>{isLoading ? "…" : filtered.length}</Badge>}
        >
          <CollapsibleSection
            title="高级：手动新建记忆"
            defaultOpen={false}
            bare
            bodyClassName="stack"
          >
            <input
              className="input"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              placeholder="/memories/projects/…/decisions.md"
            />
            <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
              {TEMPLATES.map((t) => (
                <Button
                  key={t.label}
                  size="sm"
                  onClick={() =>
                    setNewPath(
                      t.path.replace("{id}", "00000000-0000-0000-0000-000000000001"),
                    )
                  }
                >
                  {t.label}
                </Button>
              ))}
              <Button
                size="sm"
                variant="primary"
                disabled={createFile.isPending}
                onClick={() => createFile.mutate()}
              >
                新建
              </Button>
            </div>
          </CollapsibleSection>
          <div className="memory-tree-scroll scroll-region">
            {filtered.map((m) => (
              <div
                key={m.path}
                className="tree-item"
                data-active={m.path === path}
                onClick={() => setPath(m.path)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setPath(m.path);
                }}
              >
                <Badge tone={TIER_META[m.tier].tone}>{TIER_META[m.tier].label}</Badge>
                {m.isHypothesis && <Badge tone="warn">待验证</Badge>}
                {m.frozen && <Badge>已锁定</Badge>}
                <Badge
                  tone={confidenceTone(m.confidence)}
                  title={`置信度 ${((m.confidence ?? 0.5) * 100).toFixed(0)}%（被召回越多越可信，久置未读会衰减）`}
                >
                  置信 {((m.confidence ?? 0.5) * 100).toFixed(0)}%
                </Badge>
                {m.memoryKind && <Badge>{m.memoryKind}</Badge>}
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 560, fontSize: 12.5 }}>
                    {m.path.split("/").pop() || m.path}
                  </span>
                  <span
                    className="faint"
                    style={{ display: "block", fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={`${m.path} · ${m.storeId || ""} · ${m.actor || ""}`}
                  >
                    {(m.actor || "user")} · {(m.storeId || "").split(".").slice(-1)[0] || "store"} · {(m.displayPath || m.path).split("/").slice(0, -1).join(" / ")}
                  </span>
                </span>
              </div>
            ))}
            {!filtered.length && !isLoading && (
              <div className="empty">本层暂无文件。可切换层级或新建。</div>
            )}
          </div>
        </Panel>

        <Panel
          title={path ? path.split("/").pop() : "记忆内容"}
          actions={
            <div className="row" style={{ gap: 6 }}>
              {currentTier && (
                <span title={TIER_META[currentTier].hint}>
                  <Badge tone={TIER_META[currentTier].tone}>
                    {TIER_META[currentTier].label}
                  </Badge>
                </span>
              )}
              <Button disabled={!path || !!file?.frozen || save.isPending} onClick={() => save.mutate()}>
                保存
              </Button>
              <HelpTip label="锁定后只能查看，不能修改或删除。适合已确认的人物设定和项目决策。">
                <Button disabled={!path || !!file?.frozen} onClick={() => freeze.mutate()}>
                  <Lock size={13} />
                  锁定
                </Button>
              </HelpTip>
              <Button
                disabled={!path || !!file?.frozen}
                onClick={() => {
                  if (confirm(`删除 ${path}？`)) remove.mutate();
                }}
              >
                删除
              </Button>
              <HelpTip label="为当前内容存一个带时间的历史快照，之后可回滚。">
                <Button disabled={!path || snap.isPending} onClick={() => snap.mutate()}>
                  存快照
                </Button>
              </HelpTip>
              <Button
                disabled={!path}
                data-active={showHistory}
                onClick={() => setShowHistory((v) => !v)}
              >
                <History size={13} />
                历史
              </Button>
            </div>
          }
        >
          {file && (
            <div className="muted" style={{ fontSize: 12, marginBottom: 8, lineHeight: 1.6 }}>
              更新于 {new Date(file.updatedAt).toLocaleString()}
              {file.frozen ? " · 已锁定" : ""}
              {" · "}归属 <code>{file.actor || "user"}</code>
              {" · "}Store <code>{file.storeId || "—"}</code>
              {" · "}hash <code>{(file.hash || "").slice(0, 12) || "—"}</code>
              {file.sourceRunId ? ` · run ${file.sourceRunId.slice(0, 8)}` : ""}
              {file.memoryKind ? ` · ${file.memoryKind}` : ""}
              <HelpIcon text="content-hash 用于乐观并发：保存时若 hash 已变会 409 冲突，避免多智能体互相覆盖。" />
            </div>
          )}
          {showHistory && (
            <div
              className="stack"
              style={{
                marginBottom: 8,
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 8,
                maxHeight: 280,
                overflow: "auto",
              }}
            >
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong style={{ fontSize: 12 }}>历史版本 / Diff</strong>
                <span className="faint" style={{ fontSize: 11 }}>
                  {versions.length} 个
                </span>
              </div>
              {!versions.length && (
                <p className="faint" style={{ fontSize: 12, margin: "4px 0 0" }}>
                  暂无快照。每次保存会自动记录上一个版本。
                </p>
              )}
              {versions.map((v) => (
                <div
                  key={v.id}
                  className="row"
                  style={{ gap: 8, padding: "4px 0", borderTop: "1px solid var(--border)" }}
                >
                  <span className="faint" style={{ fontSize: 11, minWidth: 130 }}>
                    {new Date(v.createdAt).toLocaleString()}
                  </span>
                  <Badge>{v.actor || "user"}</Badge>
                  <span
                    className="faint"
                    style={{
                      fontSize: 11,
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={v.changeSummary || v.note || v.content}
                  >
                    {v.changeSummary || v.note || v.content.slice(0, 60) || "（空）"}
                  </span>
                  <Button size="sm" onClick={() => setDiffVersionId(v.id)}>
                    Diff
                  </Button>
                  <Button
                    size="sm"
                    disabled={!!file?.frozen || rollback.isPending}
                    onClick={() => {
                      if (confirm("回滚到此版本？当前内容会被覆盖。")) rollback.mutate(v.id);
                    }}
                  >
                    回滚
                  </Button>
                </div>
              ))}
              {diffVersionId && (
                <DiffCompare
                  leftTitle="历史版本"
                  rightTitle="当前"
                  left={
                    <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, margin: 0, maxHeight: 240, overflow: "auto" }}>
                      {versions.find((v) => v.id === diffVersionId)?.content || ""}
                    </pre>
                  }
                  right={
                    <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, margin: 0, maxHeight: 240, overflow: "auto" }}>
                      {content}
                    </pre>
                  }
                />
              )}
            </div>
          )}
          <textarea
            className="textarea"
            style={{ minHeight: 360, fontFamily: "var(--font-serif)", lineHeight: 1.8 }}
            value={content}
            readOnly={!!file?.frozen || !path}
            onChange={(e) => setContent(e.target.value)}
            placeholder="选择或新建记忆文件…"
          />
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            小贴士：还不确定的内容，标题里写「待验证」；已经定下来的决定，写进「项目决策」；保存使用 content-hash CAS，避免多智能体覆盖。
          </p>
        </Panel>
      </div>
        </>
      )}
    </div>
  );
}
