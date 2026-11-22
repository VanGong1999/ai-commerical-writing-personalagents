import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Badge,
  Button,
  Card,
  PageHeader,
  Panel,
  Toolbar,
  toast,
} from "@xiezuomanju/ui";
import { Select } from "@xiezuomanju/ui";
import { Flame } from "lucide-react";
import { useMemo, useState } from "react";
import type { ProjectFormat } from "@xiezuomanju/domain";
import { api } from "../../api/client";
import { EmptyState } from "../../components/motion";

const HOTSPOT_FORMATS: { value: ProjectFormat; label: string }[] = [
  { value: "short_novel", label: "短篇" },
  { value: "male_long", label: "男频长篇" },
  { value: "female_long", label: "女频长篇" },
  { value: "duanju", label: "短剧" },
  { value: "manju", label: "漫剧" },
  { value: "ip_adapt", label: "IP改编" },
];

export function HotspotsPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [source, setSource] = useState("");
  const [format, setFormat] = useState<ProjectFormat>("short_novel");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: "", genre: "", source: "手动", summary: "" });
  const { data: hotspots = [], isLoading } = useQuery({
    queryKey: ["hotspots"],
    queryFn: () => api.listHotspots(),
  });
  const { data: reports = [] } = useQuery({
    queryKey: ["crawl-reports"],
    queryFn: () => api.listCrawlReports(),
  });

  const sources = useMemo(() => {
    const set = new Set(hotspots.map((h) => h.source));
    return [...set].sort();
  }, [hotspots]);

  const genreStats = useMemo(() => {
    const map = new Map<string, number>();
    for (const h of hotspots) {
      const g = h.genre?.trim() || "未分类";
      map.set(g, (map.get(g) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  }, [hotspots]);

  const trend = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const h of hotspots) {
      const day = new Date(h.fetchedAt).toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    const keys = [...byDay.keys()].sort();
    return keys.map((day) => ({ day, count: byDay.get(day) ?? 0 }));
  }, [hotspots]);

  const filtered = useMemo(() => {
    return [...hotspots]
      .sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt))
      .filter((h) => {
        if (source && h.source !== source) return false;
        if (!q) return true;
        const hay = `${h.title} ${h.summary} ${h.genre}`.toLowerCase();
        return hay.includes(q.toLowerCase());
      });
  }, [hotspots, q, source]);

  const createProjectFromHotspot = async (h: (typeof hotspots)[number]) => {
    try {
      const project = await api.createProject({
        title: h.title.slice(0, 18) || "热点选题",
        format,
        genreTags: h.genre ? [h.genre] : [],
        market: "cn",
        startFrom: "existing_hook",
        coverMeta: {
          logline: h.summary,
          benchmark: h.title,
          hook: { title: h.title, summary: h.summary },
        },
      });
      await api.bindHotspot(h.id, project.id);
      toast.ok("已按热点建项目并绑定对标");
      void nav({
        to: "/studio/$format",
        params: { format: project.format },
        search: { projectId: project.id },
      });
    } catch (e) {
      toast.fail(e instanceof Error ? e.message : "创建失败");
    }
  };

  const invalidate = () => qc.invalidateQueries({ queryKey: ["hotspots"] });
  const saveHotspot = useMutation({
    mutationFn: () =>
      editingId
        ? api.updateHotspot(editingId, draft)
        : api.createHotspot(draft),
    onSuccess: () => {
      invalidate();
      setAdding(false);
      setEditingId(null);
      setDraft({ title: "", genre: "", source: "手动", summary: "" });
      toast.ok(editingId ? "热点已更新" : "热点已添加");
    },
    onError: (e) => toast.fail(e instanceof Error ? e.message : "保存失败"),
  });
  const deleteHotspot = useMutation({
    mutationFn: (id: string) => api.deleteHotspot(id),
    onSuccess: () => {
      invalidate();
      toast.ok("热点已删除");
    },
    onError: (e) => toast.fail(e instanceof Error ? e.message : "删除失败"),
  });

  return (
    <div className="page page--wide">
      <PageHeader
        title="热点榜单"
        description="汇总公开榜单上的热门题材，可以点开看摘要或转成选题。"
        actions={
          <>
            <Button
              onClick={() => {
                setAdding(true);
                setEditingId(null);
              }}
            >
              手动添加
            </Button>
            <Button onClick={() => nav({ to: "/kb/crawler" })}>爬虫 / 扫榜</Button>
            <Button
              variant="primary"
              onClick={() => {
                if (filtered[0]) void createProjectFromHotspot(filtered[0]);
                else void nav({ to: "/projects/new", search: { format } });
              }}
            >
              转为创作项目
            </Button>
          </>
        }
      />

      {(adding || editingId) && (
        <Panel title={editingId ? "编辑热点" : "手动添加热点"} style={{ marginTop: 12 }}>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <input
              className="input"
              style={{ minWidth: 220, flex: 1 }}
              placeholder="标题"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
            <input
              className="input"
              style={{ minWidth: 120, flex: 1 }}
              placeholder="题材（如 重生）"
              value={draft.genre}
              onChange={(e) => setDraft({ ...draft, genre: e.target.value })}
            />
            <input
              className="input"
              style={{ minWidth: 120, flex: 1 }}
              placeholder="来源"
              value={draft.source}
              onChange={(e) => setDraft({ ...draft, source: e.target.value })}
            />
            <Button
              variant="primary"
              disabled={!draft.title.trim() || saveHotspot.isPending}
              onClick={() => saveHotspot.mutate()}
            >
              保存
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setEditingId(null);
                setDraft({ title: "", genre: "", source: "手动", summary: "" });
              }}
            >
              取消
            </Button>
          </div>
          <textarea
            className="input"
            style={{ width: "100%", marginTop: 8, minHeight: 64 }}
            placeholder="摘要（一句话讲清卖点）"
            value={draft.summary}
            onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
          />
        </Panel>
      )}

      {genreStats.length > 0 && (
        <Panel title="题材热度分布" style={{ marginBottom: 12 }}>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            {genreStats.map(([genre, count]) => {
              const max = genreStats[0]?.[1] ?? 1;
              const pct = Math.round((count / max) * 100);
              return (
                <span
                  key={genre}
                  className="badge"
                  style={{
                    cursor: "default",
                    borderColor: "var(--accent)",
                    opacity: 0.4 + (pct / 100) * 0.6,
                  }}
                  title={`${genre} · ${count} 条`}
                >
                  {genre} · {count}
                </span>
              );
            })}
          </div>
        </Panel>
      )}

      {trend.length > 1 && (
        <Panel title="近期热度趋势" style={{ marginBottom: 12 }}>
          <div className="trend-chart" aria-label="近期热点数量趋势">
            {trend.slice(-14).map(({ day, count }) => {
              const max = Math.max(1, ...trend.map((t) => t.count));
              const pct = Math.max(8, Math.round((count / max) * 100));
              return (
                <div key={day} className="trend-chart__bar" title={`${day} · ${count} 条`}>
                  <span className="faint" style={{ fontSize: 10 }}>{count}</span>
                  <div className="trend-chart__col" style={{ height: `${pct}%` }} />
                  <span className="trend-chart__label">{day.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      <Toolbar>
        <input
          className="input"
          placeholder="搜索热点标题 / 摘要 / 题材"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select className="select" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">全部来源</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select
          className="select"
          value={format}
          onChange={(e) => setFormat(e.target.value as ProjectFormat)}
        >
          {HOTSPOT_FORMATS.map((f) => (
            <option key={f.value} value={f.value}>
              建为{f.label}
            </option>
          ))}
        </Select>
        <Badge>{filtered.length} 条</Badge>
      </Toolbar>

      {reports[0] && (
        <Panel
          title="最新扫榜报告"
          actions={
            <Button size="sm" onClick={() => nav({ to: "/kb/crawler" })}>
              打开报告台
            </Button>
          }
        >
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <strong>{reports[0].title}</strong>
              <div className="faint" style={{ fontSize: "var(--fs-xs)" }}>
                {reports[0].platform} · {reports[0].itemCount} 条 ·{" "}
                {new Date(reports[0].createdAt).toLocaleString()}
              </div>
            </div>
            <div className="row">
              {(reports[0].bodyJson?.stats?.keywords ?? []).slice(0, 6).map((k) => (
                <Badge key={k.name}>
                  {k.name} {k.count}
                </Badge>
              ))}
            </div>
          </div>
        </Panel>
      )}

      {isLoading && <div className="empty">加载中…</div>}
      {!isLoading && !filtered.length && (
        <EmptyState
          icon={<Flame size={26} />}
          title="暂无热点"
          description="去「热点采集」页开启数据源后，这里会显示公开榜单摘要。"
          action={<Button onClick={() => nav({ to: "/kb/crawler" })}>打开爬虫配置</Button>}
        />
      )}

      {!isLoading && filtered.length > 0 && (
        <div
          className="card-grid scroll-region list-scroll-region"
          style={{ marginTop: 12 }}
        >
          {filtered.map((h) => {
            const meta = (h as { meta?: Record<string, unknown> }).meta ?? {};
            const rank = meta.rank as number | undefined;
            const author = meta.author as string | undefined;
            const platform = meta.platform as string | undefined;
            return (
              <Card key={h.id}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong style={{ lineHeight: 1.35 }}>{h.title}</strong>
                  <Badge tone={h.status === "ok" ? "ok" : "warn"}>{h.status}</Badge>
                </div>
                <p className="trope-card__summary">{h.summary}</p>
                <div className="row">
                  <Badge>{h.genre}</Badge>
                  <Badge>{h.source}</Badge>
                  {platform && <Badge tone="ok">{platform}</Badge>}
                  {rank != null && <Badge>#{rank}</Badge>}
                  {author && (
                    <span className="faint" style={{ fontSize: "var(--fs-xs)" }}>
                      {author}
                    </span>
                  )}
                </div>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="faint" style={{ fontSize: "var(--fs-xs)" }}>
                    {new Date(h.fetchedAt).toLocaleString()}
                  </span>
                  <div className="row" style={{ gap: 6 }}>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => void createProjectFromHotspot(h)}
                    >
                      以此热点建项目
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => nav({ to: "/inspiration" })}
                    >
                      去做选题
                    </Button>
                    <div className="row hotspot-card__actions" style={{ gap: 4 }}>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingId(h.id);
                          setAdding(false);
                          setDraft({
                            title: h.title,
                            genre: h.genre ?? "",
                            source: h.source ?? "手动",
                            summary: h.summary ?? "",
                          });
                        }}
                      >
                        编辑
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          if (window.confirm(`删除热点「${h.title}」？`)) deleteHotspot.mutate(h.id);
                        }}
                      >
                        删除
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
