import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  Badge,
  Button,
  Card,
  PageHeader,
  Panel,
  StreamPanel,
  Toolbar,
  ViewToggle,
  toast,
} from "@xiezuomanju/ui";
import { Select } from "@xiezuomanju/ui";
import { LayoutGrid, List, Star } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { EmptyState } from "../../components/motion";
import { runAgentFeedback } from "../studio/runAgentFeedback";
import { TropeSearch, type TropeSearchPick } from "./TropeSearch";

export function TropesPage() {
  const nav = useNavigate();
  const search = useSearch({ from: "/kb/tropes" });
  const { data: tropes = [], isLoading } = useQuery({
    queryKey: ["tropes"],
    queryFn: () => api.listTropes(),
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects(),
  });
  const { data: stats } = useQuery({
    queryKey: ["trope-stats"],
    queryFn: () => api.tropeStats(),
  });
  const [q, setQ] = useState(search.q ?? "");
  const [genre, setGenre] = useState("");
  const [favOnly, setFavOnly] = useState(false);
  const [view, setView] = useState<"card" | "list">("card");
  const [variantFor, setVariantFor] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});
  const [streamText, setStreamText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const genres = useMemo(() => {
    const set = new Set<string>();
    tropes.forEach((t) => t.applicableGenres.forEach((g) => set.add(g)));
    return [...set].sort();
  }, [tropes]);

  const filtered = useMemo(() => {
    return tropes.filter((t) => {
      const fav = favorites[t.id] ?? !!t.favorited;
      if (favOnly && !fav) return false;
      if (genre && !t.applicableGenres.includes(genre)) return false;
      if (q) {
        const hay = `${t.name} ${t.summary} ${t.swapHints ?? ""} ${(t.tags ?? []).join(" ")}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [tropes, q, genre, favOnly, favorites]);

  const toggleFav = (id: string, current: boolean) => {
    const next = !current;
    setFavorites((prev) => ({ ...prev, [id]: next }));
    void api
      .toggleTropeFavorite(id, next)
      .catch(() => {
        setFavorites((prev) => ({ ...prev, [id]: current }));
        toast.fail("收藏失败，请重试");
      });
  };

  const createProjectFromTrope = async (t: (typeof tropes)[number]) => {
    try {
      const project = await api.createProject({
        title: t.name,
        format: "short_novel",
        genreTags: t.applicableGenres,
        market: "cn",
        startFrom: "existing_hook",
        coverMeta: {
          hook: { title: t.name, summary: t.summary },
          benchmark: t.name,
        },
      });
      toast.ok("已按桥段建项目，进入创作台");
      void nav({
        to: "/studio/$format",
        params: { format: project.format },
        search: { projectId: project.id },
      });
    } catch (e) {
      toast.fail(e instanceof Error ? e.message : "创建失败");
    }
  };

  const handleTropeSelect = (pick: TropeSearchPick) => {
    if (pick.kind === "trope") {
      // 桥段跳桥段：把筛选词设为该桥段名，列表直接定位到它。
      setQ(pick.trope.name);
    } else {
      void nav({ to: "/kb/docs/$id", params: { id: pick.book.docId } });
    }
  };

  const startVariant = async (tropeId: string) => {
    const trope = tropes.find((t) => t.id === tropeId);
    const projectId = [...projects].sort((a, b) =>
      b.lastOpenedAt.localeCompare(a.lastOpenedAt),
    )[0]?.id;
    setVariantFor(tropeId);
    setStreamError(null);
    setStreamText("");
    if (!projectId) {
      setStreamError("请先创建写作项目，变体将经 swap.master 入队");
      return;
    }
    if (!trope) return;
    setStreaming(true);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await runAgentFeedback(projectId, "swap.master", {
        quiet: true,
        signal: ac.signal,
        label: `梗变体 · ${trope.name}`,
        inputJson: {
          mode: "trope_variant",
          tropeId: trope.id,
          tropeName: trope.name,
          summary: trope.summary,
          swapHints: trope.swapHints,
          genres: trope.applicableGenres,
        },
        onEvent: (ev) => {
          const token =
            (typeof ev.token === "string" && ev.token) ||
            (typeof ev.text === "string" && ev.text) ||
            "";
          if (token) setStreamText((t) => t + token);
          else if (ev.type === "status") {
            setStreamText((t) => t || `入队 swap.master · ${ev.status ?? "queued"}\n`);
          }
          if (ev.type === "done") {
            setStreamText(
              (t) =>
                t ||
                `变体完成。保留情绪峰 ${trope.emotionPeak ?? "—"}，置换身份/场景/金手指。\n换元提示：${trope.swapHints || "无"}`,
            );
          }
          if (ev.type === "error") setStreamError(String(ev.message ?? "生成失败"));
        },
      });
    } catch (e) {
      if (!ac.signal.aborted) setStreamError(e instanceof Error ? e.message : String(e));
    } finally {
      setStreaming(false);
    }
  };

  const abort = () => {
    abortRef.current?.abort();
    setStreaming(false);
  };

  return (
    <div className="page page--wide tropes-page">
      <PageHeader
        title="桥段库"
        description="搜索创作素材，按情绪与题材筛选，一键练习变体"
        actions={
          <>
            <Button variant="ghost" onClick={() => nav({ to: "/kb" })}>
              返回知识库
            </Button>
            <Button onClick={() => nav({ to: "/kb" })}>从知识库文档入库</Button>
          </>
        }
      />

      <div className="stack" style={{ gap: 12, marginBottom: 12 }}>
        <TropeSearch onSelect={handleTropeSelect} />
        {stats && (
          <div className="stack" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
              <span className="faint" style={{ fontSize: "var(--fs-xs)" }}>
                梗标签 <strong style={{ color: "var(--ink)" }}>{stats.totalTropes}</strong>
              </span>
              <span className="faint" style={{ fontSize: "var(--fs-xs)" }}>
                入库书 <strong style={{ color: "var(--ink)" }}>{stats.totalDocs}</strong>
              </span>
            </div>
            <ChipGroup
              title="热门梗 / 情节"
              items={stats.tropeCounts.slice(0, 18).map((c) => ({ label: c.tag, value: c.count }))}
              onPick={(tag) => setQ(tag)}
            />
            <ChipGroup
              title="题材"
              items={stats.genreCounts.slice(0, 12).map((c) => ({ label: c.genre, value: c.count }))}
              activeValue={genre}
              onPick={(g) => setGenre(genre === g ? "" : g)}
            />
            <ChipGroup
              title="高频梗类别"
              items={stats.hookCategoryCounts
                .slice(0, 12)
                .map((c) => ({ label: c.category, value: c.count }))}
            />
          </div>
        )}
      </div>

      <Toolbar>
        <input
          className="input"
          placeholder="搜索桥段名称、摘要、换元提示"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select className="select" value={genre} onChange={(e) => setGenre(e.target.value)}>
          <option value="">全部题材</option>
          {genres.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </Select>
        <Button
          size="sm"
          variant={favOnly ? "primary" : "default"}
          onClick={() => setFavOnly((v) => !v)}
        >
          <Star size={14} />
          仅收藏
        </Button>
        <div style={{ marginLeft: "auto" }}>
          <ViewToggle
            value={view}
            onChange={(v) => setView(v as "card" | "list")}
            options={[
              { id: "card", label: "卡片", icon: LayoutGrid },
              { id: "list", label: "列表", icon: List },
            ]}
          />
        </div>
      </Toolbar>

      {isLoading && <div className="empty">加载中…</div>}

      {!isLoading && !filtered.length && (
        <EmptyState title="没有匹配的桥段" description="试试调整搜索词或筛选条件。" />
      )}

      {!isLoading && view === "card" && (
        <div className="card-grid scroll-region list-scroll-region">
          {filtered.map((t) => {
            const fav = favorites[t.id] ?? !!t.favorited;
            return (
              <Card key={t.id}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div className="trope-card__name">{t.name}</div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    aria-label={fav ? "取消收藏" : "收藏"}
                    onClick={() => toggleFav(t.id, fav)}
                  >
                    <Star
                      size={15}
                      fill={fav ? "currentColor" : "none"}
                      style={{ color: fav ? "var(--warn)" : "var(--faint)" }}
                    />
                  </button>
                </div>
                <p className="trope-card__summary">{t.summary}</p>
                {t.sourceLocator && (
                  <div className="faint" style={{ fontSize: "var(--fs-xs)" }}>
                    出处：{t.sourceLocator}
                  </div>
                )}
                <div className="row" style={{ gap: 4 }}>
                  <Badge tone={(t.emotionPeak ?? 0) >= 7 ? "ok" : "default"}>
                    情绪峰 {t.emotionPeak ?? "—"}
                  </Badge>
                  {t.applicableGenres.map((g) => (
                    <Badge key={g}>{g}</Badge>
                  ))}
                </div>
                {t.swapHints && (
                  <div className="faint" style={{ fontSize: "var(--fs-xs)" }}>
                    换元：{t.swapHints}
                  </div>
                )}
                <div className="row">
                  <Button size="sm" variant="primary" onClick={() => void startVariant(t.id)}>
                    生成变体
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void createProjectFromTrope(t)}>
                    以此桥段建项目
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {!isLoading && view === "list" && filtered.length > 0 && (
        <Panel>
          <div className="scroll-region table-scroll-region">
          <table className="table">
            <thead>
              <tr>
                <th>名称</th>
                <th>摘要</th>
                <th>情绪峰</th>
                <th>题材</th>
                <th>收藏</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const fav = favorites[t.id] ?? !!t.favorited;
                return (
                  <tr key={t.id}>
                    <td style={{ fontWeight: 600 }}>{t.name}</td>
                    <td className="muted">{t.summary}</td>
                    <td>
                      <Badge tone={(t.emotionPeak ?? 0) >= 7 ? "ok" : "default"}>
                        {t.emotionPeak ?? "—"}
                      </Badge>
                    </td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        {t.applicableGenres.map((g) => (
                          <Badge key={g}>{g}</Badge>
                        ))}
                      </div>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => toggleFav(t.id, fav)}
                      >
                        {fav ? "★" : "☆"}
                      </button>
                    </td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <Button size="sm" variant="primary" onClick={() => void startVariant(t.id)}>
                          生成变体
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void createProjectFromTrope(t)}>
                          建项目
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </Panel>
      )}

      {variantFor && (
        <div className="dialog-overlay" onClick={() => setVariantFor(null)}>
          <div
            className="dialog"
            style={{ width: "min(720px, calc(100vw - 32px))" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dialog__head">
              桥段变体 · {tropes.find((t) => t.id === variantFor)?.name ?? ""}
            </div>
            <div className="dialog__body">
              <p className="muted" style={{ fontSize: "var(--fs-xs)", marginBottom: 8 }}>
                经 <code>swap.master</code> 真实入队流式生成；保留情绪峰值，置换身份/场景/金手指。
              </p>
              {streamError ? <Badge tone="fail">{streamError}</Badge> : null}
              <StreamPanel
                text={streamText}
                streaming={streaming}
                onAbort={abort}
                onStart={() => variantFor && void startVariant(variantFor)}
              />
            </div>
            <div className="dialog__foot">
              <Button onClick={() => setVariantFor(null)}>关闭</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ChipGroup({
  title,
  items,
  onPick,
  activeValue,
}: {
  title: string;
  items: Array<{ label: string; value: number }>;
  onPick?: (label: string) => void;
  activeValue?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <span className="faint" style={{ fontSize: "var(--fs-xs)", lineHeight: "20px" }}>
        {title}
      </span>
      {items.map((it) => (
        <TropeChip
          key={it.label}
          label={it.label}
          count={it.value}
          active={activeValue === it.label}
          onClick={onPick ? () => onPick(it.label) : undefined}
        />
      ))}
    </div>
  );
}

function TropeChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        height: 20,
        padding: "0 8px",
        borderRadius: "var(--radius-sm)",
        fontSize: "var(--fs-xs)",
        lineHeight: 1,
        fontWeight: 500,
        whiteSpace: "nowrap",
        border: "1px solid transparent",
        cursor: onClick ? "pointer" : "default",
        background: active ? "var(--accent-soft)" : "var(--surface-3)",
        color: active ? "var(--accent-ink)" : "var(--ink-soft)",
      }}
      title={`${label} · ${count}`}
    >
      {label}
      <span style={{ color: active ? "var(--accent-ink)" : "var(--faint)", fontWeight: 600 }}>
        {count}
      </span>
    </button>
  );
}
