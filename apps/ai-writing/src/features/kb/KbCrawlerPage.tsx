import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Badge,
  Button,
  Card,
  CollapsibleSection,
  HelpTip,
  MarkdownDocument,
  PageHeader,
  Panel,
  StatusBadge,
  toast,
} from "@xiezuomanju/ui";
import { Select } from "@xiezuomanju/ui";
import { CircleHelp, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import type { ProjectFormat } from "@xiezuomanju/domain";
import { api, type CrawlReport, type CrawlerSource } from "../../api/client";
import {
  AnimatedNumber,
  CHART_COLORS,
  FormatBar,
} from "../../components/charts";

const FORMAT_OPTIONS: { value: ProjectFormat; label: string }[] = [
  { value: "short_novel", label: "短篇" },
  { value: "male_long", label: "男频长篇" },
  { value: "female_long", label: "女频长篇" },
  { value: "duanju", label: "短剧" },
  { value: "manju", label: "漫剧" },
  { value: "ip_adapt", label: "IP改编" },
];

const SOURCE_LINKS: Record<string, { href: string; label: string }> = {
  fanqie: { href: "https://fanqienovel.com/rank", label: "打开番茄小说榜单" },
  jinjiang: {
    href: "https://www.jjwxc.net/topten.php?orderstr=1",
    label: "打开晋江公开排行榜",
  },
  feilu: { href: "https://b.faloo.com/", label: "打开飞卢公开榜单" },
  qimao: { href: "https://www.qimao.com/rank/", label: "打开七猫排行榜" },
  qidian: { href: "https://www.qidian.com/rank/yuepiao/", label: "打开起点月票榜" },
  hongguo: { href: "https://www.hongguoduanju.com/", label: "打开红果短剧" },
};

export function KbCrawlerPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [cookieDraft, setCookieDraft] = useState<Record<string, string>>({});
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [format, setFormat] = useState<ProjectFormat>("short_novel");

  const { data: sources = [], isLoading } = useQuery({
    queryKey: ["crawler-sources"],
    queryFn: () => api.listCrawlerSources(),
  });

  const { data: reports = [], refetch: refetchReports } = useQuery({
    queryKey: ["crawl-reports"],
    queryFn: () => api.listCrawlReports(),
  });
  const { data: scheduled = [] } = useQuery({
    queryKey: ["scheduled-tasks"],
    queryFn: () => api.listScheduled(),
  });

  const activeReport = useMemo(
    () => reports.find((r) => r.id === activeReportId) ?? reports[0] ?? null,
    [reports, activeReportId],
  );

  const activeItems = activeReport?.bodyJson?.items ?? [];
  const activeGenres = useMemo(
    () =>
      [...(activeReport?.bodyJson?.stats?.genres ?? [])].sort(
        (a, b) => b.count - a.count,
      ),
    [activeReport],
  );
  const activeKeywords = useMemo(
    () =>
      [...(activeReport?.bodyJson?.stats?.keywords ?? [])].sort(
        (a, b) => b.count - a.count,
      ),
    [activeReport],
  );
  const allGenreNames = useMemo(
    () =>
      new Set(
        reports.flatMap((report) =>
          (report.bodyJson?.stats?.genres ?? []).map((genre) => genre.name),
        ),
      ),
    [reports],
  );
  const allKeywordNames = useMemo(
    () =>
      new Set(
        reports.flatMap((report) =>
          (report.bodyJson?.stats?.keywords ?? []).map((keyword) => keyword.name),
        ),
      ),
    [reports],
  );
  const totalCollectedItems = useMemo(
    () => reports.reduce((sum, report) => sum + report.itemCount, 0),
    [reports],
  );

  const genreTrend = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of reports.slice(0, 5)) {
      for (const g of r.bodyJson?.stats?.genres ?? []) {
        map.set(g.name, (map.get(g.name) ?? 0) + g.count);
      }
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [reports]);

  /** 最近两次报告题材对比：上升 / 下降 / 新晋 */
  const genreDelta = useMemo(() => {
    const latest = reports[0]?.bodyJson?.stats?.genres ?? [];
    const prev = reports[1]?.bodyJson?.stats?.genres ?? [];
    if (!latest.length) return [] as { name: string; now: number; prev: number; delta: number }[];
    const prevMap = new Map(prev.map((g) => [g.name, g.count]));
    const names = new Set([...latest.map((g) => g.name), ...prev.map((g) => g.name)]);
    return [...names]
      .map((name) => {
        const now = latest.find((g) => g.name === name)?.count ?? 0;
        const was = prevMap.get(name) ?? 0;
        return { name, now, prev: was, delta: now - was };
      })
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.now - a.now)
      .slice(0, 10);
  }, [reports]);

  const patchMut = useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<Pick<CrawlerSource, "enabled" | "robotsAck" | "interval">> & {
        cookie?: string;
      };
    }) => api.patchCrawlerSource(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crawler-sources"] }),
  });

  const runMut = useMutation({
    mutationFn: ({ id, cookie }: { id: string; cookie?: string }) =>
      api.runCrawlerSource(id, cookie),
    onSuccess: async (row) => {
      await qc.invalidateQueries({ queryKey: ["crawler-sources"] });
      await qc.invalidateQueries({ queryKey: ["hotspots"] });
      const list = await refetchReports();
      const latest = list.data?.find((r) => r.sourceId === row.id);
      if (latest) setActiveReportId(latest.id);
      if (row.status === "ok") {
        toast.ok(`${row.name} 抓取完成 · ${row.lastItemCount ?? 0} 条`);
      } else if (row.needsCookie) {
        toast.warn(`${row.name} 需要登录凭证：请粘贴后重试`);
      } else {
        toast.fail(row.lastError || `${row.name} 抓取失败`);
      }
    },
    onError: (e: Error) => {
      setError(e.message);
      toast.fail(e.message);
    },
  });

  const saveCookie = async (id: string) => {
    const cookie = cookieDraft[id]?.trim();
    if (!cookie) {
      toast.warn("请先粘贴登录凭证");
      return;
    }
    await patchMut.mutateAsync({ id, patch: { cookie } });
    toast.ok("登录凭证已保存（只存在本机）");
  };

  const createScheduledMut = useMutation({
    mutationFn: () =>
      api.createScheduled({
        id: `crawler.run.${Date.now()}`,
        name: "定时抓取公开榜单",
        cronOrInterval: "12h",
        enabled: true,
        ownerScope: "user",
        description: "对已启用并确认允许访问的数据源，采集公开榜单摘要",
        payloadTemplate: { type: "crawler.run" },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduled-tasks"] });
      toast.ok("已创建定时抓取任务（调度器会按间隔入队）");
    },
    onError: (e: Error) => toast.fail(e.message),
  });

  const toggleScheduled = (id: string, enabled: boolean) =>
    api.patchScheduled(id, enabled).then(() => {
      qc.invalidateQueries({ queryKey: ["scheduled-tasks"] });
      toast.ok(enabled ? "已启用" : "已停用");
    });

  const statusTone = (s: string) =>
    s === "failed" ? "fail" : s === "ok" ? "ok" : s === "running" ? "warn" : "default";
  const statusLabel = (s: string) =>
    s === "failed"
      ? "失败"
      : s === "ok"
        ? "正常"
        : s === "running"
          ? "抓取中"
          : "空闲";
  const enabledCount = sources.filter((source) => source.enabled).length;
  const healthyCount = sources.filter((source) => source.status === "ok").length;
  const attentionCount = sources.filter(
    (source) => source.status === "failed" || source.needsCookie,
  ).length;
  const reportStatusData = [
    {
      format: "ok",
      label: "可用报告",
      value: reports.filter((report) => report.status === "ok").length,
    },
    {
      format: "failed",
      label: "失败报告",
      value: reports.filter((report) => report.status !== "ok").length,
    },
  ].filter((entry) => entry.value > 0);

  return (
    <div className="page page--wide">
      <PageHeader
        title="热点采集"
        description="从公开榜单获取热门题材摘要，帮你找选题。只读取公开信息，不会抓取付费正文。"
        actions={
          <>
            <Button onClick={() => nav({ to: "/kb/hotspots" })}>热点列表</Button>
            <Select
              className="select"
              value={format}
              onChange={(e) => setFormat(e.target.value as ProjectFormat)}
            >
              {FORMAT_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>
                  建为{f.label}
                </option>
              ))}
            </Select>
            <Button
              variant="primary"
              onClick={() => nav({ to: "/projects/new", search: { format } })}
            >
              根据热点生成核心梗
            </Button>
          </>
        }
      />

      {error && (
        <div className="row" style={{ marginBottom: 8 }}>
          <Badge tone="fail">{error}</Badge>
        </div>
      )}

      <div className="grid grid-3" style={{ marginBottom: 12 }}>
        <Card>
          <strong>合规边界</strong>
          <p className="muted" style={{ fontSize: "var(--fs-xs)", margin: "6px 0 0" }}>
            只抓书名 / 排名 / 作者 / 题材 / 简介摘要。禁止正文、付费章、绕登录墙。
          </p>
        </Card>
        <Card>
          <strong>课内应盯平台</strong>
          <p className="muted" style={{ fontSize: "var(--fs-xs)", margin: "6px 0 0" }}>
            选题榜单：番茄、飞卢、七猫、晋江、起点；漫剧分发：红果。公开榜单会直接读取，无需登录凭证。
          </p>
        </Card>
        <Card>
          <strong>报告产物</strong>
          <p className="muted" style={{ fontSize: "var(--fs-xs)", margin: "6px 0 0" }}>
            每次采集会生成一份选题参考：题材分布、关键词、行动建议和核心梗种子。
          </p>
        </Card>
      </div>

      <div className="kb-stat-strip" aria-label="数据源状态">
        <span><strong>{sources.length}</strong> 个数据源</span>
        <span><strong>{enabledCount}</strong> 已启用</span>
        <span><strong>{healthyCount}</strong> 最近成功</span>
        <span><strong>{attentionCount}</strong> 需处理</span>
        <span className="kb-stat-strip__hint">确认平台允许公开访问后，开启数据源才会开始采集。</span>
      </div>

      <div className="crawler-metrics">
        <div className="crawler-metric">
          <span className="crawler-metric__eyebrow">扫榜报告</span>
          <strong><AnimatedNumber value={reports.length} /></strong>
          <span>份报告已归档</span>
        </div>
        <div className="crawler-metric">
          <span className="crawler-metric__eyebrow">榜单条目</span>
          <strong><AnimatedNumber value={totalCollectedItems} /></strong>
          <span>条公开元数据</span>
        </div>
        <div className="crawler-metric">
          <span className="crawler-metric__eyebrow">来源覆盖</span>
          <strong><AnimatedNumber value={healthyCount} /><small> / {sources.length}</small></strong>
          <span>个来源最近成功</span>
        </div>
        <div className="crawler-metric">
          <span className="crawler-metric__eyebrow">题材光谱</span>
          <strong><AnimatedNumber value={allGenreNames.size} /></strong>
          <span>个题材被识别</span>
        </div>
        <div className="crawler-metric">
          <span className="crawler-metric__eyebrow">高频信号</span>
          <strong><AnimatedNumber value={allKeywordNames.size} /></strong>
          <span>个关键词进入热榜</span>
        </div>
      </div>

      <div className="crawler-insight-grid">
        <Panel
          className="crawler-insight-panel"
          title="当前报告 · 题材结构"
          actions={
            activeReport ? <Badge>{activeReport.platform}</Badge> : undefined
          }
        >
          {activeGenres.length ? (
            <div className="crawler-chart-wrap">
              <FormatBar
                data={activeGenres.slice(0, 8).map((genre) => ({
                  format: genre.name,
                  label: genre.name,
                  value: genre.count,
                }))}
                color={CHART_COLORS[0]}
                height={210}
              />
              <div className="crawler-chart-caption">
                <span>按当前报告的题材出现次数统计</span>
                <span>覆盖 {activeItems.length} 条榜单记录</span>
              </div>
            </div>
          ) : (
            <div className="empty">选择一份扫榜报告后，这里会显示题材分布。</div>
          )}
        </Panel>

        <Panel
          className="crawler-insight-panel"
          title="关键词热度云"
          actions={
            activeKeywords.length ? <Badge>{activeKeywords.length} 个词</Badge> : undefined
          }
        >
          {activeKeywords.length ? (
            <>
              <div className="crawler-keyword-cloud" aria-label="榜单关键词热度">
                {activeKeywords.slice(0, 18).map((keyword, index) => {
                  const max = activeKeywords[0]?.count ?? 1;
                  const scale = Math.max(0.86, Math.min(1.5, 0.86 + (keyword.count / max) * 0.64));
                  return (
                    <span
                      key={keyword.name}
                      className="crawler-keyword-chip"
                      style={{
                        fontSize: `${scale}rem`,
                        animationDelay: `${index * 35}ms`,
                        opacity: 0.58 + Math.min(0.42, keyword.count / max / 2),
                      }}
                      title={`${keyword.name} · 出现 ${keyword.count} 次`}
                    >
                      {keyword.name}
                      <small>{keyword.count}</small>
                    </span>
                  );
                })}
              </div>
              <div className="crawler-report-health">
                {reportStatusData.map((entry) => (
                  <div key={entry.format}>
                    <span>{entry.label}</span>
                    <div className="crawler-report-health__track">
                      <span
                        style={{
                          width: `${reports.length ? (entry.value / reports.length) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <strong>{entry.value}</strong>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="empty">抓取后会自动提炼书名、简介和题材里的高频词。</div>
          )}
        </Panel>

        <Panel
          className="crawler-insight-panel"
          title="榜首观察"
          actions={
            activeItems.length ? (
              <Button size="sm" variant="ghost" onClick={() => nav({ to: "/kb/hotspots" })}>
                全部热点
              </Button>
            ) : undefined
          }
        >
          {activeItems.length ? (
            <ol className="crawler-top-list">
              {activeItems.slice(0, 4).map((item, index) => (
                <li key={`${item.rank}-${item.title}`} data-rank={index + 1}>
                  <span className="crawler-top-list__rank">{item.rank}</span>
                  <div>
                    <strong>{item.title}</strong>
                    <span>
                      {item.author || "作者未公开"} · {item.genre || "综合"}
                    </span>
                    <p>{item.abstract || "暂无简介摘要"}</p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="empty">暂无榜单条目。</div>
          )}
        </Panel>
      </div>

      <div className="crawler-main-flow">
      <Panel className="crawler-source-panel" title="数据源">
        {isLoading ? (
          <div className="muted">加载中…</div>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {sources.map((s) => (
              <CollapsibleSection
                key={s.id}
                title={s.name}
                summary={
                  s.lastError
                    ? s.lastError
                    : s.lastRunAt
                      ? `${s.lastItemCount ?? 0} 条 · ${new Date(s.lastRunAt).toLocaleDateString()}`
                      : "尚未抓取"
                }
                badge={
                  <Badge tone={statusTone(s.status)}>{statusLabel(s.status)}</Badge>
                }
                defaultOpen={Boolean(s.needsCookie || s.lastError)}
                storageKey={`crawler-source-${s.id}`}
                actions={
                  <div className="row crawler-source-actions">
                    {SOURCE_LINKS[s.id] && (
                      <a
                        className="crawler-source-link"
                        href={SOURCE_LINKS[s.id].href}
                        target="_blank"
                        rel="noreferrer"
                        title={SOURCE_LINKS[s.id].label}
                      >
                        <ExternalLink size={13} />
                        榜单链接
                      </a>
                    )}
                    <label className="row" style={{ fontSize: "var(--fs-xs)" }}>
                      <input
                        type="checkbox"
                        checked={s.robotsAck}
                        onChange={() =>
                          patchMut.mutate({ id: s.id, patch: { robotsAck: !s.robotsAck } })
                        }
                      />
                      确认允许公开访问
                    </label>
                    <label className="row" style={{ fontSize: "var(--fs-xs)" }}>
                      <input
                        type="checkbox"
                        checked={s.enabled}
                        onChange={() =>
                          patchMut.mutate({ id: s.id, patch: { enabled: !s.enabled } })
                        }
                      />
                      启用
                    </label>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={
                        !s.robotsAck ||
                        !s.enabled ||
                        s.status === "running" ||
                        (runMut.isPending && runMut.variables?.id === s.id)
                      }
                      loading={runMut.isPending && runMut.variables?.id === s.id}
                      onClick={() => {
                        setError(null);
                        runMut.mutate({
                          id: s.id,
                          cookie: cookieDraft[s.id]?.trim() || undefined,
                        });
                      }}
                    >
                      抓取并生成报告
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      className="crawler-source-actions__danger"
                      onClick={() => {
                        if (window.confirm(`删除数据源「${s.name}」？`)) {
                          void api
                            .deleteCrawlerSource(s.id)
                            .then(() => {
                              qc.invalidateQueries({ queryKey: ["crawler-sources"] });
                              toast.ok("数据源已删除");
                            })
                            .catch((e) => toast.fail(e instanceof Error ? e.message : "删除失败"));
                        }
                      }}
                    >
                      删除
                    </Button>
                  </div>
                }
              >
                <div className="row" style={{ gap: 8, flexWrap: "wrap", fontSize: "var(--fs-xs)" }}>
                  <span className="muted">{s.scope}</span>
                  {s.needsCookie && <Badge tone="warn">需要登录凭证</Badge>}
                  {s.hasCookie && <Badge tone="ok">已保存登录凭证</Badge>}
                  <span className="faint">
                    最近：{s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : "—"}
                  </span>
                  <span className="faint">条目：{s.lastItemCount ?? 0}</span>
                </div>
                {s.lastError && (
                  <p className="crawler-source-error">{s.lastError}</p>
                )}

                {s.needsCookie && (
                  <div className="stack" style={{ marginTop: 8 }}>
                    <div className="crawler-cookie-label">
                      <span>
                        登录凭证 <span className="faint">Cookie</span>
                      </span>
                      <CookieHelp sourceId={s.id} />
                    </div>
                    <textarea
                      className="textarea"
                      rows={2}
                      placeholder={`粘贴 ${s.name} 的完整 Cookie 请求头。`}
                      value={cookieDraft[s.id] ?? ""}
                      onChange={(e) =>
                        setCookieDraft((d) => ({ ...d, [s.id]: e.target.value }))
                      }
                    />
                    <div className="row">
                      <Button size="sm" onClick={() => void saveCookie(s.id)}>
                        保存登录凭证
                      </Button>
                      <span className="faint" style={{ fontSize: "var(--fs-2xs)" }}>
                        也可写入环境变量 CRAWLER_COOKIE_QIDIAN 等
                      </span>
                    </div>
                  </div>
                )}
              </CollapsibleSection>
            ))}
          </div>
        )}
      </Panel>

      <div className="crawler-dual-panels">
        <Panel
          className="panel--fill crawler-scroll-panel"
          title="题材波动"
          actions={<Badge>近 5 次抓取</Badge>}
        >
          <div className="crawler-panel-scroll">
          {genreTrend.length ? (
            <div className="stack" style={{ gap: 12 }}>
              <div>
                <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                  题材累计热度
                </div>
                {genreTrend.map(([name, count], index) => (
                  <div key={name} className="crawler-genre-row">
                    <span className="crawler-genre-row__rank">{index + 1}</span>
                    <span className="crawler-genre-row__name">{name}</span>
                    <div className="progress crawler-genre-row__track">
                        <div
                          className="progress__fill"
                          style={{
                            width: `${Math.max(8, Math.min(100, count * 8))}%`,
                          }}
                        />
                    </div>
                    <Badge>{count}</Badge>
                  </div>
                ))}
              </div>
              {genreDelta.length > 0 && (
                <div>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                    最近两次报告环比（选题优先看上升 / 新晋）
                  </div>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>题材</th>
                        <th>本次</th>
                        <th>上次</th>
                        <th>变化</th>
                      </tr>
                    </thead>
                    <tbody>
                      {genreDelta.map((g) => (
                        <tr key={g.name}>
                          <td>{g.name}</td>
                          <td>{g.now}</td>
                          <td>{g.prev}</td>
                          <td>
                            <Badge
                              tone={
                                g.prev === 0 && g.now > 0
                                  ? "ok"
                                  : g.delta > 0
                                    ? "ok"
                                    : g.delta < 0
                                      ? "fail"
                                      : "default"
                              }
                            >
                              {g.prev === 0 && g.now > 0
                                ? "新晋"
                                : g.delta > 0
                                  ? `↑${g.delta}`
                                  : g.delta < 0
                                    ? `↓${Math.abs(g.delta)}`
                                    : "持平"}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Button
                    size="sm"
                    style={{ marginTop: 8 }}
                    onClick={() =>
                      nav({
                        to: "/projects/new",
                        search: {
                          format,
                        },
                      })
                    }
                  >
                    用上升题材新建项目
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="empty">先启用数据源并抓取，这里会汇总题材分布与环比波动</div>
          )}
          </div>
        </Panel>

        <Panel
          className="panel--fill crawler-scroll-panel"
          title="扫榜报告"
          actions={
            <div className="crawler-report-toolbar">
              {reports.length > 1 ? (
                <Select
                  className="select crawler-report-select"
                  aria-label="切换扫榜报告"
                  value={activeReport?.id ?? ""}
                  onChange={(event) => setActiveReportId(event.target.value)}
                >
                  {reports.map((report) => (
                    <option key={report.id} value={report.id}>
                      {report.platform} · {report.boardName} ·{" "}
                      {new Date(report.createdAt).toLocaleDateString("zh-CN")}
                    </option>
                  ))}
                </Select>
              ) : (
                <Badge>{reports.length} 份</Badge>
              )}
              {activeReport && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => nav({ to: "/kb/hotspots" })}
                >
                  查看热点
                </Button>
              )}
            </div>
          }
        >
          <div className="crawler-panel-scroll">
          {reports.length === 0 ? (
            <div className="empty">还没有报告。先确认允许公开访问，再开启数据源，最后点采集。</div>
          ) : (
            activeReport && <ReportView report={activeReport} />
          )}
          </div>
        </Panel>
      </div>
      </div>

      <Panel title="定时抓取" style={{ marginTop: 12 }}>
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
            定时任务会按设定时间自动运行，只采集已开启并确认允许公开访问的数据源。
          </div>
          <Button
            variant="primary"
            disabled={createScheduledMut.isPending}
            onClick={() => createScheduledMut.mutate()}
          >
            新建「12h 定时抓取」
          </Button>
        </div>
        <div className="stack" style={{ marginTop: 10 }}>
          {scheduled
            .filter((t) => (t.payloadTemplate as Record<string, unknown> | undefined)?.type === "crawler.run" || t.id.startsWith("crawler.run"))
            .map((t) => (
              <div key={t.id} className="agent-task-row">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: "var(--fs-sm)" }}>{t.name}</div>
                  <div className="faint" style={{ fontSize: "var(--fs-2xs)" }}>
                    {t.cronOrInterval} · {t.enabled ? "启用中" : "已停用"}
                    {t.lastRunAt ? ` · 上次 ${new Date(t.lastRunAt).toLocaleString("zh-CN")}` : ""}
                  </div>
                </div>
                <StatusBadge tone={t.enabled ? "ok" : "idle"} label={t.enabled ? "启用" : "停用"} />
                <Button size="sm" onClick={() => void toggleScheduled(t.id, !t.enabled)}>
                  {t.enabled ? "停用" : "启用"}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    if (window.confirm(`删除定时任务「${t.name}」？`)) {
                      void api
                        .deleteScheduled(t.id)
                        .then(() => {
                          qc.invalidateQueries({ queryKey: ["scheduled"] });
                          toast.ok("定时任务已删除");
                        })
                        .catch((e) => toast.fail(e instanceof Error ? e.message : "删除失败"));
                    }
                  }}
                >
                  删除
                </Button>
              </div>
            ))}
          {!scheduled.some(
            (t) => (t.payloadTemplate as Record<string, unknown> | undefined)?.type === "crawler.run" || t.id.startsWith("crawler.run"),
          ) && <div className="empty">还没有定时抓取任务，点上方按钮创建一个。</div>}
        </div>
      </Panel>
    </div>
  );
}

function CookieHelp({ sourceId }: { sourceId: string }) {
  const sourceName =
    sourceId === "qimao"
      ? "七猫"
      : sourceId === "qidian"
        ? "起点"
        : sourceId === "hongguo"
          ? "红果"
          : "当前网站";
  const domain = (() => {
    const href = SOURCE_LINKS[sourceId]?.href;
    if (!href) return "目标网站域名";
    try {
      return new URL(href).hostname;
    } catch {
      return "目标网站域名";
    }
  })();

  return (
    <HelpTip
      className="cookie-help-tip"
      side="left"
      label={
        <div className="cookie-help">
          <strong>如何获取 {sourceName} Cookie</strong>
          <ol>
            <li>按 F12 打开开发者工具，进入「Network / 网络」。</li>
            <li>刷新{sourceName}排行榜，点击该网站的榜单请求。</li>
            <li>找到「Headers / 标头 → Request Headers / 请求标头」。</li>
            <li>复制 <code>Cookie:</code> 后面的整段值并粘贴到这里。</li>
          </ol>
          <div className="cookie-help__note">
            只使用 <code>{domain}</code> 自己的 Cookie，不要混入
            <code>turing.captcha.qcloud.com</code> 等验证码域名的 Cookie。
          </div>
          <div className="cookie-help__format">
            格式：<code>name1=value1; name2=value2</code>
          </div>
          <span className="cookie-help__privacy">
            Cookie 等同登录凭据，只保存在本机；如已失效，请重新登录后再复制。
          </span>
        </div>
      }
    >
      <button
        type="button"
        className="crawler-cookie-help"
        aria-label={`如何获取${sourceName} Cookie`}
      >
        <CircleHelp size={15} />
        <span>如何获取</span>
      </button>
    </HelpTip>
  );
}

function ReportView({ report }: { report: CrawlReport }) {
  const stats = report.bodyJson?.stats;
  const items = report.bodyJson?.items ?? [];
  const authorCount = new Set(
    items.map((item) => item.author?.trim()).filter(Boolean),
  ).size;
  const topGenre = stats?.genres?.[0];
  const topKeyword = stats?.keywords?.[0];
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <strong>{report.title}</strong>
          <div className="faint" style={{ fontSize: "var(--fs-xs)" }}>
            {report.platform} · {report.boardName} ·{" "}
            {new Date(report.createdAt).toLocaleString()} · {report.itemCount} 条
          </div>
        </div>
        <StatusBadge
          tone={report.status === "ok" ? "ok" : report.needsCookie ? "warn" : "fail"}
          label={report.status === "ok" ? "可用" : report.needsCookie ? "需要登录凭证" : "失败"}
        />
      </div>

      {report.needsCookie && report.cookieHint && (
        <div className="help-callout help-callout--warn">
          <div className="help-callout__title">需要你提供登录凭证</div>
          <div className="help-callout__body">{report.cookieHint}</div>
        </div>
      )}
      {report.error && <Badge tone="fail">{report.error}</Badge>}

      <div className="crawler-report-snapshot">
        <div>
          <strong>{report.itemCount}</strong>
          <span>榜单条目</span>
        </div>
        <div>
          <strong>{stats?.genres?.length ?? 0}</strong>
          <span>题材分类</span>
        </div>
        <div>
          <strong>{authorCount || "—"}</strong>
          <span>公开作者</span>
        </div>
        <div>
          <strong>{topGenre?.name ?? "—"}</strong>
          <span>第一题材 · {topGenre?.count ?? 0}</span>
        </div>
        <div>
          <strong>{topKeyword?.name ?? "—"}</strong>
          <span>高频词 · {topKeyword?.count ?? 0}</span>
        </div>
      </div>

      <div className="crawler-keyword-row">
        {(stats?.keywords ?? []).slice(0, 10).map((k) => (
          <Badge key={k.name}>
            {k.name} · {k.count}
          </Badge>
        ))}
      </div>

      {(report.bodyJson?.advice ?? []).slice(0, 4).map((a) => (
        <div key={a} className="muted" style={{ fontSize: "var(--fs-sm)" }}>
          · {a}
        </div>
      ))}

      {items.length > 0 && (
        <div className="crawler-report-table-wrap">
          <table className="table crawler-report-table">
            <thead>
              <tr>
                <th>#</th>
                <th>书名</th>
                <th>作者</th>
                <th>题材</th>
                <th>状态</th>
                <th>标签</th>
                <th>摘要</th>
              </tr>
            </thead>
            <tbody>
              {items.slice(0, 30).map((it) => (
                <tr key={`${it.rank}-${it.title}`}>
                  <td>{it.rank}</td>
                  <td style={{ fontWeight: 600 }}>
                    {it.url ? (
                      <a href={it.url} target="_blank" rel="noreferrer">
                        {it.title}
                        <ExternalLink size={10} style={{ marginLeft: 4 }} />
                      </a>
                    ) : (
                      it.title
                    )}
                  </td>
                  <td className="muted">{it.author || "—"}</td>
                  <td>
                    <Badge>{it.genre || "综合"}</Badge>
                  </td>
                  <td className="muted">{it.status || "—"}</td>
                  <td>
                    <div className="crawler-item-tags">
                      {(it.tags ?? []).slice(0, 2).map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                      {!(it.tags ?? []).length && <span>—</span>}
                    </div>
                  </td>
                  <td className="muted crawler-report-abstract">{it.abstract || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(report.bodyJson?.hookSeeds ?? []).length > 0 && (
        <Panel title="可转化核心梗种子">
          <div className="stack">
            {report.bodyJson?.hookSeeds?.slice(0, 6).map((s) => (
              <div key={s} style={{ fontSize: "var(--fs-sm)" }}>
                {s}
              </div>
            ))}
          </div>
        </Panel>
      )}

      <details>
        <summary className="muted" style={{ cursor: "pointer", fontSize: "var(--fs-xs)" }}>
          查看完整 Markdown 报告
        </summary>
        <div style={{ marginTop: 8, maxHeight: 360, overflow: "auto" }}>
          <MarkdownDocument source={report.bodyMarkdown ?? ""} />
        </div>
      </details>
    </div>
  );
}
