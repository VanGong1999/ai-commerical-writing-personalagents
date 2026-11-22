import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Badge,
  Button,
  HelpCallout,
  HelpIcon,
  HelpTip,
  PageHeader,
  Panel,
  Toolbar,
  toast,
} from "@xiezuomanju/ui";
import { Select } from "@xiezuomanju/ui";
import { useMemo, useRef, useState } from "react";
import { api } from "../../api/client";

const DOC_TYPE_OPTIONS = [
  { value: "novel", label: "网文小说" },
  { value: "short", label: "短篇" },
  { value: "script_manju", label: "漫剧剧本" },
  { value: "script_duanju", label: "短剧剧本" },
  { value: "notes", label: "笔记" },
];

export function KbHomePage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: docs = [] } = useQuery({ queryKey: ["kb-docs"], queryFn: () => api.listDocs() });
  const { data: folders = [] } = useQuery({
    queryKey: ["kb-folders"],
    queryFn: () => api.listFolders(),
  });
  const [q, setQ] = useState("");
  const [includeWeb, setIncludeWeb] = useState(false);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState("novel");
  const [docKind, setDocKind] = useState<"benchmark" | "draft">("benchmark");
  const [docFilter, setDocFilter] = useState<"all" | "benchmark" | "draft">("all");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: search } = useQuery({
    queryKey: ["kb-search", q, includeWeb],
    queryFn: () => api.searchKb(q, { includeWeb }),
    enabled: q.length >= 0,
  });

  const uploadMut = useMutation({
    mutationFn: async () => {
      const finalTitle = title.trim() || file?.name.replace(/\.[^.]+$/, "") || "未命名文档";
      let doc;
      if (file) {
        doc = await api.uploadKbDoc(file, {
          title: finalTitle,
          docType,
          tags: [docKind === "benchmark" ? "对标书" : "我的草稿"],
        });
      } else {
        doc = await api.createKbDoc({
          title: finalTitle,
          docType,
          tags: [docKind === "benchmark" ? "对标书" : "我的草稿"],
        });
      }
      const analyze = await api.analyzeKbDoc(doc.id);
      return { doc, analyze };
    },
    onSuccess: ({ doc, analyze }) => {
      setStatusMsg(`已上传「${doc.title}」，分析任务 ${analyze.jobId.slice(0, 8)}…`);
      setUploadOpen(false);
      setTitle("");
      setFile(null);
      setError(null);
      qc.invalidateQueries({ queryKey: ["kb-docs"] });
      toast.ok(`已上传「${doc.title}」并开始分析`);
    },
    onError: (e: Error) => {
      setError(e.message);
      toast.fail(e.message);
    },
  });

  const activeDocId =
    selectedDocId && docs.some((doc) => doc.id === selectedDocId)
      ? selectedDocId
      : docs[0]?.id;
  const readyCount = docs.filter((doc) => doc.status === "ready" || doc.status === "indexed").length;
  const analyzingCount = docs.filter((doc) => doc.status === "analyzing").length;
  const filteredDocs = docs.filter((d) => {
    if (folderId && d.folderId !== folderId) return false;
    if (tagFilter && !d.tags?.includes(tagFilter)) return false;
    if (docFilter === "benchmark") {
      if (d.tags?.includes("我的草稿")) return false;
      if (d.tags?.includes("对标书")) return true;
      return ["novel", "short", "script_manju", "script_duanju"].includes(d.docType);
    }
    if (docFilter === "draft") {
      if (d.tags?.includes("我的草稿")) return true;
      if (d.tags?.includes("对标书")) return false;
      return d.docType === "notes";
    }
    return true;
  });
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const d of docs) {
      for (const t of d.tags ?? []) set.add(t);
    }
    return [...set].slice(0, 14);
  }, [docs]);

  const createFolderMut = useMutation({
    mutationFn: (name: string) => api.createFolder(name),
    onSuccess: () => {
      setNewFolderName("");
      qc.invalidateQueries({ queryKey: ["kb-folders"] });
    },
  });
  const moveDocMut = useMutation({
    mutationFn: (args: { docId: string; folderId: string | null }) =>
      api.moveDoc(args.docId, args.folderId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kb-docs"] }),
  });
  const totalWords = docs.reduce((sum, doc) => sum + (doc.wordCount ?? 0), 0);
  const statusLabel: Record<string, string> = {
    ready: "已就绪",
    indexed: "已入库",
    analyzing: "分析中",
    failed: "失败",
  };

  return (
    <div className="page page--wide">
      <HelpCallout title="知识库怎么用" tone="info" collapsible defaultOpen={false}>
        上传参考作品（如小说/剧本）→ 等拆解分析完成 → 点进文档阅读九类报告 →
        「应用到写作台」开始写自己的故事。报告是给人看的要点，不是代码。
        推荐阅读顺序：拆书参数 → 单元故事 → 核心梗 → 情绪曲线 → 文风 → 风险红线；
        想换皮仿写看「换元工作台」，想找同款看「相似书」。
        <HelpIcon text="支持 docx / txt / md。分析大约一两分钟，完成后列表状态会变为「已就绪」。" />
      </HelpCallout>
      <PageHeader
        title="知识库"
        description="上传分析 · 自动标签 · 拆解报告 · 桥段 · 人物关系图 · AI 搜索"
        actions={
          <>
            <HelpTip label="把新上传和修改过的资料重新整理进搜索库。资料多时需要等一会儿。">
              <Button
                onClick={() => {
                  void api.reindexKnowledge().then(
                    () => toast.ok("知识搜索更新已开始，稍后就能搜到最新内容"),
                    (e: Error) => toast.fail(e.message),
                  );
                }}
              >
                更新知识搜索
              </Button>
            </HelpTip>
            <Button onClick={() => nav({ to: "/kb/tropes" })}>桥段库</Button>
            <Button onClick={() => nav({ to: "/kb/hotspots" })}>热点榜单</Button>
            <Button onClick={() => nav({ to: "/kb/crawler" })}>热点采集</Button>
            <Button variant="primary" onClick={() => setUploadOpen(true)}>
              上传文档
            </Button>
          </>
        }
      />

      <Toolbar>
        <input
          className="input"
          placeholder="搜索知识，例如「系统文 + 末世 + 开篇强冲突」"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="row" style={{ gap: 6, whiteSpace: "nowrap" }}>
          <input
            type="checkbox"
            checked={includeWeb}
            onChange={(e) => setIncludeWeb(e.target.checked)}
          />
          包含联网
        </label>
        {search?.answer && <Badge tone="ok">{search.answer}</Badge>}
      </Toolbar>

      {(search?.local || search?.web) && q && (
        <div className="stack" style={{ marginBottom: 12, gap: 8 }}>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <Badge>
              本地 { (search.local?.docs?.length ?? search.docs.length) + (search.local?.tropes?.length ?? search.tropes.length) } 条
            </Badge>
            {search.web && (
              <Badge tone={search.web.enabled === false ? "warn" : "ok"}>
                联网 {search.web.results?.length ?? 0} 条
                {search.web.source ? ` · ${search.web.source}` : ""}
              </Badge>
            )}
          </div>
          {includeWeb && search.web?.summary && (
            <div className="web-search-summary">
              <strong>{search.web.enabled === false ? "联网搜索未启用" : "联网结果"}</strong>
              <p style={{ margin: "4px 0 0" }}>{search.web.summary}</p>
              {(search.web.results ?? []).length > 0 && (
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {search.web.results!.slice(0, 8).map((hit, idx) => (
                    <li key={idx}>
                      <a href={hit.url} target="_blank" rel="noreferrer">
                        {hit.title || hit.url}
                      </a>
                      {hit.snippet ? ` — ${hit.snippet}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      <div className="kb-stat-strip" aria-label="知识库概览">
        <span><strong>{docs.length}</strong> 份文档</span>
        <span><strong>{readyCount}</strong> 已就绪</span>
        <span><strong>{analyzingCount}</strong> 分析中</span>
        <span><strong>{totalWords.toLocaleString()}</strong> 累计字数</span>
        <span className="kb-stat-strip__hint">点击文档卡片进入文档，再从下方报告入口直接打开对应分析。</span>
      </div>

      <div className="kb-home-stack">
        <Panel
          title="标签与分组"
          actions={<Badge>{filteredDocs.length} / {docs.length} 份</Badge>}
        >
          <div className="kb-filter-strip">
            <div className="kb-filter-line">
              <span className="muted">文件夹</span>
              <button
                type="button"
                className="kb-filter-chip"
                data-active={folderId === null}
                onClick={() => setFolderId(null)}
              >
                全部文档
              </button>
              {folders.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="kb-filter-chip"
                  data-active={folderId === f.id}
                  onClick={() => setFolderId(f.id)}
                >
                  {f.name}
                </button>
              ))}
              <div className="row kb-folder-create">
                <input
                  className="input"
                  placeholder="新建文件夹"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newFolderName.trim()) {
                      createFolderMut.mutate(newFolderName.trim());
                    }
                  }}
                />
                <Button
                  size="sm"
                  disabled={!newFolderName.trim() || createFolderMut.isPending}
                  onClick={() => createFolderMut.mutate(newFolderName.trim())}
                >
                  新建
                </Button>
              </div>
            </div>
            <div className="kb-filter-line">
              <span className="muted">标签</span>
              <button
                type="button"
                className="kb-filter-chip"
                data-active={tagFilter === null}
                onClick={() => setTagFilter(null)}
              >
                全部标签
              </button>
              {allTags.map((t) => (
                <button
                  key={t}
                  type="button"
                  className="kb-filter-chip"
                  data-active={tagFilter === t}
                  onClick={() => setTagFilter(tagFilter === t ? null : t)}
                >
                  {t}
                </button>
              ))}
              {!allTags.length && (
                <span className="faint" style={{ fontSize: 12 }}>
                  拆解完成后自动生成标签
                </span>
              )}
            </div>
          </div>
        </Panel>

        <Panel
          title="文档"
          actions={
            <div className="row" style={{ gap: 5 }}>
              {(
                [
                  ["all", "全部"],
                  ["benchmark", "对标书"],
                  ["draft", "我的草稿/笔记"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className="kb-filter-chip"
                  data-active={docFilter === key}
                  onClick={() => setDocFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          }
        >
          {statusMsg && (
            <div className="row" style={{ marginBottom: 8 }}>
              <Badge tone="ok">{statusMsg}</Badge>
            </div>
          )}
          <div className="kb-doc-grid kb-doc-grid--scroll scroll-region">
            {filteredDocs.map((d) => {
              const folder = folders.find((f) => f.id === d.folderId);
              return (
                <article
                  key={d.id}
                  className="kb-doc-card"
                  data-active={d.id === activeDocId}
                  role="button"
                  tabIndex={0}
                  onClick={() => nav({ to: "/kb/docs/$id", params: { id: d.id } })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      nav({ to: "/kb/docs/$id", params: { id: d.id } });
                    }
                  }}
                >
                  <div className="kb-doc-card__top">
                    <strong>{d.title}</strong>
                    <Badge
                      tone={
                        d.status === "ready" || d.status === "indexed"
                          ? "ok"
                          : d.status === "failed"
                            ? "fail"
                            : "warn"
                      }
                    >
                      {statusLabel[d.status] ?? d.status}
                    </Badge>
                  </div>
                  <div className="row" style={{ flexWrap: "wrap", gap: 5 }}>
                    <Badge>
                      {DOC_TYPE_OPTIONS.find((item) => item.value === d.docType)?.label ??
                        d.docType}
                    </Badge>
                    {folder && <Badge>{folder.name}</Badge>}
                    {d.tags.map((t) => (
                      <Badge key={t} tone={t === tagFilter ? "ok" : "default"}>
                        {t}
                      </Badge>
                    ))}
                  </div>
                  <div className="kb-doc-card__foot">
                    <span className="faint">
                      {d.wordCount?.toLocaleString() ?? 0} 字 · 点击打开文档与报告
                    </span>
                    <div className="row" style={{ gap: 6 }}>
                      <Select
                        className="select kb-doc-card__folder"
                        value={d.folderId ?? ""}
                        title="移动到文件夹"
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => {
                          event.stopPropagation();
                          moveDocMut.mutate({
                            docId: d.id,
                            folderId: event.target.value || null,
                          });
                        }}
                      >
                        <option value="">未归档</option>
                        {folders.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </Select>
                      <span className="kb-doc-card__enter">打开 →</span>
                    </div>
                  </div>
                </article>
              );
            })}
            {!filteredDocs.length && (
              <div className="empty kb-doc-grid__empty">
                {docs.length ? "当前筛选下没有文档。" : "上传一篇 TXT、MD 或 DOCX，开始拆解。"}
              </div>
            )}
          </div>
        </Panel>

        <Panel
          title="分析报告入口"
          actions={
            docs.length ? (
              <div className="row" style={{ gap: 6 }}>
                <span className="faint" style={{ fontSize: 11 }}>
                  报告对象
                </span>
                <Select
                  className="select"
                  aria-label="选择报告对应文档"
                  value={activeDocId ?? ""}
                  onChange={(event) => setSelectedDocId(event.target.value)}
                >
                  {docs.map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.title}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null
          }
        >
          <div className="kb-report-grid">
            {[
              ["dissect", "拆解参数报告", "11 项：期待感、冲突、起承转合与七步法"],
              ["unit", "单元故事拆解", "大 / 中 / 小单元，只深拆值得学习的部分"],
              ["core", "核心梗提取", "梗与情节卡分层，提炼可迁移的情绪链条"],
              ["style", "文风要素", "抽句式、节奏和信息差，学习写法但不抄内容"],
              ["gap", "对标差距报告", "当前稿件与爆款结构相比，还缺什么"],
            ].map(([key, label, desc]) => (
              <button
                key={key}
                type="button"
                className="kb-report-card"
                disabled={!activeDocId}
                onClick={() =>
                  activeDocId &&
                  nav({
                    to: "/kb/docs/$id",
                    params: { id: activeDocId },
                    search: { report: key },
                  })
                }
              >
                <span style={{ flex: 1 }}>
                  <div>{label}</div>
                  <div className="faint" style={{ fontSize: "var(--fs-xs)" }}>
                    {desc}
                  </div>
                </span>
                <span className="faint">→</span>
              </button>
            ))}
          </div>
          <div className="kb-report-footer">
            <span className="faint">
              当前文档：{docs.find((doc) => doc.id === activeDocId)?.title ?? "请先选择文档"}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={!activeDocId}
              onClick={() =>
                activeDocId && nav({ to: "/kb/graph/$id", params: { id: activeDocId } })
              }
            >
              查看人物关系图 →
            </Button>
          </div>
        </Panel>
      </div>

      {uploadOpen && (
        <div className="dialog-overlay" onClick={() => setUploadOpen(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog__head">上传文档</div>
            <div className="dialog__body stack">
              <p className="muted" style={{ margin: 0, fontSize: "var(--fs-sm)" }}>
                支持 TXT / MD / 剧本文本。上传后自动：解析清洗 → 分类打标 → 切片入库 → 分析流水线。
              </p>
              {error && <Badge tone="fail">{error}</Badge>}
              <label className="stack">
                <span className="muted">标题</span>
                <input
                  className="input"
                  placeholder="对标爆款·xxx"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label className="stack">
                <span className="muted">类型</span>
                <Select
                  className="select"
                  value={docType}
                  onChange={(e) => setDocType(e.target.value)}
                >
                  {DOC_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="stack">
                <span className="muted">用途分类</span>
                <Select
                  className="select"
                  value={docKind}
                  onChange={(e) => setDocKind(e.target.value as "benchmark" | "draft")}
                >
                  <option value="benchmark">对标书（拆解参考）</option>
                  <option value="draft">我的草稿</option>
                </Select>
              </label>
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.md,.docx,.doc,text/plain,text/markdown"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f);
                  if (f && !title.trim()) {
                    setTitle(f.name.replace(/\.[^.]+$/, ""));
                  }
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                style={{
                  border: "1px dashed var(--line-strong)",
                  borderRadius: "var(--radius)",
                  padding: "28px 16px",
                  textAlign: "center",
                  color: "var(--faint)",
                  background: "transparent",
                  cursor: "pointer",
                  width: "100%",
                }}
              >
                {file ? `已选：${file.name}` : "拖拽文件到此处，或点击选择"}
              </button>
            </div>
            <div className="dialog__foot">
              <Button onClick={() => setUploadOpen(false)}>取消</Button>
              <Button
                variant="primary"
                disabled={uploadMut.isPending || (!file && !title.trim())}
                onClick={() => {
                  setError(null);
                  uploadMut.mutate();
                }}
              >
                {uploadMut.isPending ? "上传中…" : "开始分析"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
