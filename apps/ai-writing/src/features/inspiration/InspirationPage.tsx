import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { FORMAT_LABELS, type ProjectFormat } from "@xiezuomanju/domain";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  PageHeader,
  Panel,
  Tabs,
  toast,
} from "@xiezuomanju/ui";
import { useMemo, useState } from "react";
import { api, type Inspiration } from "../../api/client";

const SCORE_LABELS: Record<string, string> = {
  empathy: "共鸣",
  thrill: "爽感",
  diff: "差异化",
  motivation: "动机",
  mainline: "主线",
  shell: "壳",
  market: "市场",
};

function ScoreRadar({ scores, size = 180 }: { scores: Record<string, number>; size?: number }) {
  const metrics = Object.keys(SCORE_LABELS).filter((k) => scores[k] != null);
  if (metrics.length < 3) {
    return <div className="muted" style={{ fontSize: 12 }}>评分维度不足，无法绘制雷达图。</div>;
  }
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 28;
  const angle = (i: number) => (Math.PI * 2 * i) / metrics.length - Math.PI / 2;
  const point = (i: number, r: number) => [
    cx + Math.cos(angle(i)) * r,
    cy + Math.sin(angle(i)) * r,
  ];
  const rings = [0.25, 0.5, 0.75, 1];
  const poly = metrics
    .map((m, i) => {
      const r = radius * Math.max(0, Math.min(1, (scores[m] ?? 0) / 10));
      return point(i, r).join(",");
    })
    .join(" ");
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="评分雷达">
      {rings.map((r) => (
        <polygon
          key={r}
          points={metrics.map((_, i) => point(i, radius * r).join(",")).join(" ")}
          fill="none"
          stroke="var(--line)"
          strokeWidth="1"
        />
      ))}
      {metrics.map((_, i) => {
        const [x, y] = point(i, radius);
        return (
          <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--line)" strokeWidth="1" />
        );
      })}
      <polygon points={poly} fill="color-mix(in srgb, var(--accent) 22%, transparent)" stroke="var(--accent)" strokeWidth="1.5" />
      {metrics.map((m, i) => {
        const [x, y] = point(i, radius + 16);
        return (
          <text key={m} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fill="var(--muted)" fontSize="11">
            {SCORE_LABELS[m]} {scores[m]}
          </text>
        );
      })}
    </svg>
  );
}

const LEVELS = [
  {
    id: "notion" as const,
    label: "一念",
    hint: "一闪而过的念头，先记下来",
    placeholder: "例：如果高考前夜能看见未来……",
  },
  {
    id: "idea" as const,
    label: "灵感",
    hint: "有情绪或画面感的片段",
    placeholder: "例：破产继承人在婚礼上被当众揭穿身份",
  },
  {
    id: "concept" as const,
    label: "创意",
    hint: "有冲突、可延展的方向",
    placeholder: "例：重生者用信息差反杀商业宿敌",
  },
  {
    id: "topic" as const,
    label: "选题",
    hint: "能投稿、有壳有爽点的选题",
    placeholder: "例：命运回放系统 + 家族破产倒计时",
  },
];

const PATHS = [
  {
    id: "storyline",
    label: "从故事线出发（路径A）",
    desc: "故事线下行：设定 + 过程 + 结果，再嵌七步法/关系网（8 课）。",
    fields: ["设定", "过程", "结果"],
  },
  {
    id: "event",
    label: "从核心事件出发（路径B）",
    desc: "口诀四步：上补头尾 → 下猜因果 → 人设冲突 → 爽点往里加（8 课）。",
    fields: ["核心事件", "上补头尾", "下猜因果(≥2)", "人设冲突", "爽点(≥2)"],
  },
  {
    id: "plot",
    label: "从情节出发（路径C）",
    desc: "情节三要素：人 + 事 + 冲突（物理/情感/目标阻碍）+ 场景（8 课）。",
    fields: ["人", "事", "冲突·物理", "冲突·情感", "冲突·目标阻碍", "场景氛围"],
  },
];

const SHELLS = [
  {
    name: "升级流",
    tags: ["新人友好", "男频", "漫剧12课"],
    track: "upgrade" as const,
    note: "12 课：buff叠满→打击→金手指→复仇→同级→跨级→高潮。≠短剧四壳。",
  },
  {
    name: "反套路",
    tags: ["主流", "脑洞", "漫剧12课"],
    track: "anti_trope" as const,
    note: "12 课：角色层→剧情层（建议写到这）→世界观层；玩梗先囤梗。",
  },
  {
    name: "后悔流",
    tags: ["高价值", "高门槛", "漫剧12课"],
    track: "regret" as const,
    note: "12 课：开头 buff 叠满 + 付出历史写饱满；被动等对方后悔。",
  },
  {
    name: "追妻火葬场五部曲",
    tags: ["女频"],
    note: "8 课：决裂期 → 转折期 → 男主觉醒期 → 追妻期 → 结局（禁过早原谅）。",
  },
  { name: "误会梗", tags: ["女频", "拉扯"], note: "8 课：信息差驱动高张力。" },
  { name: "英雄救美", tags: ["女频", "关系推进"], note: "8 课：时机在尊严最低处出手。" },
];

const STRUCTURE_LEVELS = [
  { id: "storyline", label: "故事线", form: "简介", example: "唐僧师徒西天取经" },
  { id: "core_event", label: "核心事件", form: "大纲", example: "出轨被抓→决裂→追妻" },
  { id: "plot", label: "情节", form: "章纲", example: "当众羞辱导致决裂" },
  { id: "scene_event", label: "事件", form: "细纲", example: "雨夜抢药材四描写" },
];

type CandidateRow = {
  id: string;
  inspirationId: string;
  title: string;
  logline: string;
  format: ProjectFormat;
  scores: Record<string, number>;
  risk: string[];
  genreTags: string[];
};

function candidatesFromInspirations(rows: Inspiration[]): CandidateRow[] {
  const unique = new Map<string, CandidateRow>();
  for (const row of rows) {
    const hint = (row.formatHint as ProjectFormat | null) || "manju";
    const format: ProjectFormat =
      hint in FORMAT_LABELS ? (hint as ProjectFormat) : "manju";
    row.candidates.forEach((c, i) => {
      const next: CandidateRow = {
        id: `${row.id}-${i}`,
        inspirationId: row.id,
        title: String(c.title ?? "未命名候选"),
        logline: String(c.logline ?? ""),
        format,
        scores: (c.scores as Record<string, number>) ?? {},
        risk: Array.isArray(c.risk) ? (c.risk as string[]) : [],
        genreTags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
      };
      const key = `${format}|${next.title.trim()}|${next.logline.trim()}`;
      const existing = unique.get(key);
      if (!existing) {
        unique.set(key, next);
        return;
      }
      for (const [metric, value] of Object.entries(next.scores)) {
        existing.scores[metric] = Math.max(existing.scores[metric] ?? 0, value);
      }
      existing.risk = [...new Set([...existing.risk, ...next.risk])];
    });
  }
  return [...unique.values()];
}

export function InspirationPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState("levels");
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pathDrafts, setPathDrafts] = useState<Record<string, Record<string, string>>>({});
  const [busyLevel, setBusyLevel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set());
  const [compareOpen, setCompareOpen] = useState(false);

  const { data: inspirations = [] } = useQuery({
    queryKey: ["inspirations"],
    queryFn: () => api.listInspirations(),
  });

  const candidates = useMemo(() => candidatesFromInspirations(inspirations), [inspirations]);

  const createMut = useMutation({
    mutationFn: api.createInspiration,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inspirations"] }),
  });

  const expandMut = useMutation({
    mutationFn: (id: string) => api.expandInspiration(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inspirations"] });
      setTab("candidates");
    },
  });

  const createFromCandidate = async (c: CandidateRow) => {
    try {
      const proj = await api.createProject({
        title: c.title.trim() || "未命名项目",
        format: c.format,
        genreTags: c.genreTags,
        market: "cn",
        startFrom: "existing_hook",
        coverMeta: {
          logline: c.logline,
          hook: { title: c.title, summary: c.logline },
        },
      });
      setCreatedId(c.id);
      toast.ok("已创建项目，进入创作台");
      void nav({
        to: "/studio/$format",
        params: { format: proj.format },
        search: { projectId: proj.id },
      });
    } catch (e) {
      toast.fail(e instanceof Error ? e.message : "创建失败");
    }
  };

  const saveLevel = async (levelId: (typeof LEVELS)[number]["id"], expand: boolean) => {
    const text = (drafts[levelId] ?? "").trim();
    if (!text) {
      setError("请先填写内容");
      return;
    }
    setError(null);
    setBusyLevel(levelId);
    try {
      const row = await createMut.mutateAsync({ level: levelId, sourceText: text });
      if (expand) {
        await expandMut.mutateAsync(row.id);
        toast.ok("已扩写为选题候选");
      } else {
        await qc.invalidateQueries({ queryKey: ["inspirations"] });
        toast.ok("灵感已保存");
      }
      setDrafts((d) => ({ ...d, [levelId]: "" }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.fail(msg);
    } finally {
      setBusyLevel(null);
    }
  };

  const generateFromPath = async (pathId: string, fields: string[]) => {
    const values = pathDrafts[pathId] ?? {};
    const parts = fields.map((f) => `${f}：${(values[f] ?? "").trim() || "（空）"}`);
    const sourceText = `[${pathId}] ${parts.join("；")}`;
    setError(null);
    setBusyLevel(pathId);
    try {
      const row = await createMut.mutateAsync({
        level: "concept",
        sourceText,
        tags: [pathId],
      });
      await expandMut.mutateAsync(row.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyLevel(null);
    }
  };

  const topCandidates = candidates
    .slice()
    .sort((a, b) => {
      const sa = Object.values(a.scores).reduce((s, v) => s + v, 0);
      const sb = Object.values(b.scores).reduce((s, v) => s + v, 0);
      return sb - sa;
    })
    .slice(0, 3);

  return (
    <div className="page page--wide">
      <PageHeader
        title="灵感选题"
        description="发现选题、评估潜力，一键转为创作项目"
        actions={
          <Button variant="primary" onClick={() => nav({ to: "/projects/new", search: { format: undefined } })}>
            新建项目
          </Button>
        }
      />

      {topCandidates.length > 0 && (
        <section className="home-section">
          <div className="home-section__head">
            <div>
              <h2>AI 推荐选题</h2>
              <p>按综合评分排序，可直接开项目</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setTab("candidates")}>
              查看全部候选
            </Button>
          </div>
          <div className="rec-grid">
            {topCandidates.map((c) => {
              const scoreSum = Object.values(c.scores).reduce((s, v) => s + v, 0);
              return (
                <Card key={c.id} className="rec-card">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <strong>{c.title}</strong>
                    <Badge tone="ok">潜力 {scoreSum || "—"}</Badge>
                  </div>
                  <p className="trope-card__summary">{c.logline || "暂无卖点摘要"}</p>
                  <div className="row">
                    <Badge>{FORMAT_LABELS[c.format]}</Badge>
                    {c.risk.slice(0, 2).map((r) => (
                      <Badge key={r} tone="warn">
                        {r}
                      </Badge>
                    ))}
                  </div>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => void createFromCandidate(c)}
                  >
                    转为创作项目
                  </Button>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {error && (
        <div className="row" style={{ marginBottom: 8 }}>
          <Badge tone="fail">{error}</Badge>
        </div>
      )}

      <div className="row" style={{ margin: "14px 0" }}>
        <Tabs
          tabs={[
            { id: "levels", label: "灵感采集层级" },
            { id: "structure", label: "结构四层级判层" },
            { id: "topic9", label: "短篇选题（9课）" },
            { id: "paths", label: "创作路径" },
            { id: "shells", label: "题材模板" },
            { id: "candidates", label: `选题候选 (${candidates.length})` },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {tab === "levels" && (
        <div className="stack" style={{ gap: 10 }}>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            采集成熟度：一念→灵感→创意→选题。与「结构四层级」（故事线/核心事件/情节/事件）不同名异义，勿混用。
          </p>
          <div className="grid grid-4">
          {LEVELS.map((level, i) => (
            <Panel
              key={level.id}
              title={
                <>
                  <Badge tone="default">{i + 1}</Badge> {level.label}
                </>
              }
            >
              <div className="stack">
                <p className="muted" style={{ margin: 0, fontSize: "var(--fs-xs)" }}>
                  {level.hint}
                </p>
                <textarea
                  className="textarea"
                  rows={3}
                  placeholder={level.placeholder}
                  value={drafts[level.id] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [level.id]: e.target.value }))}
                />
                <div className="row">
                  <Button
                    variant="primary"
                    disabled={busyLevel === level.id}
                    onClick={() => void saveLevel(level.id, true)}
                  >
                    {busyLevel === level.id ? "扩写中…" : "升维扩写"}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busyLevel === level.id}
                    onClick={() => void saveLevel(level.id, false)}
                  >
                    保存
                  </Button>
                </div>
              </div>
            </Panel>
          ))}
          </div>
        </div>
      )}

      {tab === "structure" && (
        <div className="stack" style={{ gap: 12 }}>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            下笔前先判结构层级，再进创作路径 A/B/C。完备编排台在短篇工作室的「灵感成故事（8.md）」工作台。
          </p>
          <div className="grid grid-4">
            {STRUCTURE_LEVELS.map((lv, i) => (
              <Panel
                key={lv.id}
                title={
                  <>
                    <Badge>{i + 1}</Badge> {lv.label}
                  </>
                }
              >
                <p className="muted" style={{ margin: 0, fontSize: "var(--fs-xs)" }}>
                  文本形态：{lv.form}
                </p>
                <p style={{ margin: "8px 0 0", fontSize: 13 }}>例：{lv.example}</p>
              </Panel>
            ))}
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <Badge>故事线 → 路径A</Badge>
            <Badge>核心事件 → 路径B 口诀</Badge>
            <Badge>情节 → 路径C 三要素</Badge>
            <Badge tone="warn">事件 → 归巢情节/核心事件</Badge>
          </div>
          <Button
            variant="primary"
            onClick={() => {
              toast.info("先转成短篇项目，再在「总纲 / 章纲」步骤打开「灵感成故事」工作台");
              void nav({ to: "/projects/new", search: { format: "short_novel" } });
            }}
          >
            去新建短篇项目并进入总装台
          </Button>
        </div>
      )}

      {tab === "topic9" && (
        <div className="stack" style={{ gap: 12 }}>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            9 课：定受众 → 扒榜 → 选题加法/反差 → 伏笔反转 → 导语~200 → 全书 11–13 故事情节 → 处刑 QC。完备台在短篇 SYNOPSIS；人设深化见 10 课。
          </p>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <Badge>受众互斥二选一</Badge>
            <Badge>扒榜只看设定+关键词+内核</Badge>
            <Badge>11–13≠章内情节点</Badge>
            <Badge tone="warn">爽点/画面链 L4/L6</Badge>
          </div>
          <Button
            variant="primary"
            onClick={() => {
              toast.info("先新建短篇项目，再在「总纲」步骤打开「短篇选题」工作台");
              void nav({ to: "/projects/new", search: { format: "short_novel" } });
            }}
          >
            去短篇项目打开选题台
          </Button>
        </div>
      )}

      {tab === "paths" && (
        <div className="grid grid-3">
          {PATHS.map((path) => (
            <Panel key={path.id} title={path.label}>
              <div className="stack">
                <p className="muted" style={{ margin: 0, fontSize: "var(--fs-xs)" }}>
                  {path.desc}
                </p>
                {path.fields.map((field) => (
                  <label key={field} className="stack">
                    <span className="muted">{field}</span>
                    <input
                      className="input"
                      placeholder={`填写${field}`}
                      value={pathDrafts[path.id]?.[field] ?? ""}
                      onChange={(e) =>
                        setPathDrafts((d) => ({
                          ...d,
                          [path.id]: { ...(d[path.id] ?? {}), [field]: e.target.value },
                        }))
                      }
                    />
                  </label>
                ))}
                <Button
                  variant="primary"
                  disabled={busyLevel === path.id}
                  onClick={() => void generateFromPath(path.id, path.fields)}
                >
                  {busyLevel === path.id ? "生成中…" : "生成候选"}
                </Button>
              </div>
            </Panel>
          ))}
        </div>
      )}

      {tab === "shells" && (
        <div className="grid grid-3">
          {SHELLS.map((shell) => (
            <div key={shell.name} className="pkg-card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>{shell.name}</strong>
                <div className="row">
                  {shell.tags.map((t) => (
                    <Badge key={t}>{t}</Badge>
                  ))}
                </div>
              </div>
              <p>{shell.note}</p>
              <Button
                variant="ghost"
                onClick={() => {
                  if ("track" in shell && shell.track) {
                    toast.info(
                      `将打开漫剧项目；在 S0 设定台选「${shell.name}」题材轨（12课），勿与短剧四壳混淆`,
                    );
                    void nav({
                      to: "/projects/new",
                      search: { format: "manju", title: shell.name },
                    });
                    return;
                  }
                  void nav({
                    to: "/projects/new",
                    search: {
                      format: shell.tags.includes("女频")
                        ? "female_long"
                        : shell.tags.includes("男频")
                          ? "male_long"
                          : "manju",
                    },
                  });
                }}
              >
                用此模板 →
              </Button>
            </div>
          ))}
        </div>
      )}

      {tab === "candidates" && (
        <Panel
          title="选题候选"
          actions={
            <div className="row" style={{ gap: 8 }}>
              <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                已选 {compareIds.size}/3
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={compareIds.size < 2}
                onClick={() => setCompareOpen(true)}
              >
                对比已选
              </Button>
              <Button variant="primary" onClick={() => nav({ to: "/projects/new", search: { format: undefined } })}>
                手动新建
              </Button>
            </div>
          }
        >
          <div className="scroll-region table-scroll-region">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 32 }}>比</th>
                <th>标题钩</th>
                <th>一句话卖点</th>
                <th>格式</th>
                <th>评分</th>
                <th>风险</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => (
                <tr key={c.id} data-selected={createdId === c.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={compareIds.has(c.id)}
                      onChange={() =>
                        setCompareIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(c.id)) next.delete(c.id);
                          else if (next.size < 3) next.add(c.id);
                          return next;
                        })
                      }
                    />
                  </td>
                  <td style={{ fontWeight: 600 }}>{c.title}</td>
                  <td className="muted">{c.logline}</td>
                  <td>{FORMAT_LABELS[c.format]}</td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      {Object.entries(c.scores).map(([k, v]) => (
                        <span key={k} className="badge" title={k}>
                          {k} {v}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    {c.risk.length
                      ? c.risk.map((r) => (
                          <Badge key={r} tone="warn">
                            {r}
                          </Badge>
                        ))
                      : "—"}
                  </td>
                  <td>
                    <Button
                      variant="primary"
                      disabled={
                        (c.scores.shell ?? 10) < 5 ||
                        (c.scores.empathy ?? 10) < 5 ||
                        (c.scores.market ?? 10) < 5
                      }
                      title={
                        (c.scores.shell ?? 10) < 5 ||
                        (c.scores.empathy ?? 10) < 5 ||
                        (c.scores.market ?? 10) < 5
                          ? "商品思维未过闸：壳/共鸣/市场需 ≥5"
                          : undefined
                      }
                      onClick={() => {
                        setCreatedId(c.id);
                        void createFromCandidate(c);
                      }}
                    >
                      创建项目
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {!candidates.length && <EmptyState>暂无候选选题 — 在「灵感采集层级」或「创作路径」中扩写生成</EmptyState>}
        </Panel>
      )}

      <Modal
        open={compareOpen && compareIds.size > 0}
        onOpenChange={setCompareOpen}
        title={`候选对比（${compareIds.size}）`}
        description="横向比较评分与卖点，关闭后继续挑选。"
        width={1000}
        footer={<Button onClick={() => setCompareOpen(false)}>关闭</Button>}
      >
        <div className="candidate-compare__grid">
          {candidates
            .filter((c) => compareIds.has(c.id))
            .map((c) => (
              <div key={c.id} className="candidate-compare__card">
                <strong>{c.title}</strong>
                <ScoreRadar scores={c.scores} />
                <div className="candidate-compare__scores">
                  {Object.entries(SCORE_LABELS).map(([k, label]) =>
                    c.scores[k] != null ? (
                      <div key={k} className="candidate-compare__row">
                        <span>{label}</span>
                        <div className="progress-track">
                          <div
                            className="progress-fill"
                            style={{ width: `${Math.min(100, (c.scores[k] / 10) * 100)}%` }}
                          />
                        </div>
                        <b>{c.scores[k]}</b>
                      </div>
                    ) : null,
                  )}
                </div>
                <p className="muted">{c.logline}</p>
              </div>
            ))}
        </div>
      </Modal>
    </div>
  );
}
