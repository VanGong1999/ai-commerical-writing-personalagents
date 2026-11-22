import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Badge, Button, PageHeader, Panel, toast } from "@xiezuomanju/ui";
import { Select } from "@xiezuomanju/ui";
import { useEffect, useMemo, useState } from "react";
import { api, type FleetCreateInput, type FleetState } from "../../api/client";
import { subscribeJobEvents } from "../../api/sse";

const TEAMS: Array<{
  id: "synthesis" | "ordered" | "union";
  name: string;
  desc: string;
  mergePolicy: FleetCreateInput["mergePolicy"];
  members: FleetCreateInput["members"];
}> = [
  {
    id: "synthesis",
    name: "多位助手一起想选题",
    desc: "让几位助手同时想核心梗，再把好点子汇总到一起。",
    mergePolicy: "semantic_repair",
    members: [
      { name: "hook-a", task: "产出 3 个差异化核心梗候选 A 组", agentId: "topic.core_hook_batch" },
      { name: "hook-b", task: "产出 3 个差异化核心梗候选 B 组", agentId: "topic.core_hook_batch" },
      { name: "market", task: "对候选做市场/卖点粗评", agentId: "topic.score" },
    ],
  },
  {
    id: "ordered",
    name: "按顺序推进",
    desc: "先策划、再搭结构，一步一步往下做。",
    mergePolicy: "human",
    members: [
      { name: "planner", task: "确认本项目下一步目标与要求", agentId: "orch.writing" },
      { name: "struct", task: "给出结构/大纲推进建议", agentId: "struct.unit_arc" },
    ],
  },
  {
    id: "union",
    name: "分组并行准备",
    desc: "一组准备人物，一组准备世界观，最后由你确认采用。",
    mergePolicy: "human",
    members: [
      { name: "char", task: "七步法人物草案", agentId: "char.seven_step" },
      { name: "world", task: "世界观骨架草案", agentId: "world.bible" },
    ],
  },
];

function fleetStatusLabel(state: FleetState | undefined): string {
  if (!state) return "—";
  if (state.awaitingHumanMerge) return "待人工合并";
  if (state.humanMerge) return state.humanMerge.accepted ? "已确认合并" : "已拒绝合并";
  if (state.mergedArtifactId) return "已落盘";
  if (state.synthesisJobId) return "综合中";
  const reports = state.reports || [];
  if (!reports.length) return "空";
  if (reports.every((r) => r.status === "done")) return "成员完成";
  if (reports.some((r) => r.status === "failed")) return "有失败";
  if (reports.some((r) => r.status === "running")) return "运行中";
  return "排队中";
}

export function ColleaguePage({ embedded = false }: { embedded?: boolean }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [activeFleetId, setActiveFleetId] = useState<string | null>(null);
  const [mergeNote, setMergeNote] = useState("");
  const [liveByJob, setLiveByJob] = useState<Record<string, string>>({});

  const { data: proposals = [] } = useQuery({
    queryKey: ["proposals"],
    queryFn: () => api.listProposals(),
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects({}),
  });

  const effectiveProjectId = projectId;

  const [adviser,setAdviser]=useState("");
  const advisers=useQuery({queryKey:["knowledge-agents",projectId],enabled:!!projectId,queryFn:()=>api.listAgentCatalog(undefined,projectId)});
  const selected=advisers.data?.agents.find(a=>a.custom && a.id===adviser);
  const fleetsQuery = useQuery({
    queryKey: ["fleets", effectiveProjectId],
    queryFn: () => api.listFleets(effectiveProjectId),
    enabled: Boolean(effectiveProjectId),
  });

  const fleetQuery = useQuery({
    queryKey: ["fleet", activeFleetId],
    queryFn: () => api.getFleet(activeFleetId!),
    enabled: Boolean(activeFleetId),
    refetchInterval: (q) => {
      const s = q.state.data;
      if (!s) return 2000;
      if (s.awaitingHumanMerge || s.humanMerge) return false;
      const reports = s.reports || [];
      const allTerminal =
        reports.length > 0 && reports.every((r) => r.status === "done" || r.status === "failed");
      if (allTerminal && !s.synthesisJobId) return false;
      return 2000;
    },
  });

  useEffect(() => {
    if (!activeFleetId) return;
    const s = fleetQuery.data;
    if (!s) return;
    if (s.awaitingHumanMerge) {
      toast.info("协作结果需要你确认后才能采用");
    }
  }, [activeFleetId, fleetQuery.data?.awaitingHumanMerge]);

  const activeJobIds = useMemo(() => {
    const reports = fleetQuery.data?.reports || [];
    return reports
      .filter((r) => r.jobId && r.status !== "done" && r.status !== "failed")
      .map((r) => String(r.jobId));
  }, [fleetQuery.data?.reports]);

  // 舰队成员 Job SSE：实时 token/status，终态刷新 fleet
  useEffect(() => {
    if (!activeFleetId || !activeJobIds.length) return;
    const unsubs = activeJobIds.map((jobId) =>
      subscribeJobEvents(jobId, {
        onEvent: (ev) => {
          const token =
            (typeof ev.token === "string" && ev.token) ||
            (typeof ev.text === "string" && ev.text) ||
            "";
          if (token) {
            setLiveByJob((prev) => ({
              ...prev,
              [jobId]: ((prev[jobId] || "") + token).slice(-400),
            }));
          } else if (ev.type === "status" && ev.status) {
            setLiveByJob((prev) => ({
              ...prev,
              [jobId]: prev[jobId] || `状态：${ev.status}`,
            }));
          }
        },
        onDone: () => {
          void qc.invalidateQueries({ queryKey: ["fleet", activeFleetId] });
          void qc.invalidateQueries({ queryKey: ["fleets", effectiveProjectId] });
        },
      }),
    );
    return () => {
      for (const u of unsubs) u();
    };
  }, [activeFleetId, activeJobIds.join("|"), effectiveProjectId, qc]);

  const scan = useMutation({
    mutationFn: () => api.colleagueScan(),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["proposals"] });
      toast.ok(`已检查，发现 ${res.proposalsCreated} 条可以做的事`);
    },
    onError: () => toast.info("扫描失败，请确认 API 已启动"),
  });

  const launchTeam = useMutation({
    mutationFn: async (team: (typeof TEAMS)[number]) => {
      const pid = effectiveProjectId;
      if (!pid) throw new Error("请先选择或创建项目");
      const res = await api.createFleet({
        projectId: pid,
        mode: team.id,
        mergePolicy: team.mergePolicy,
        members: selected ? [...team.members,{name:selected.name,agentId:selected.id,task:"核查本项目授权知识来源，提交有引文的报告"}] : team.members,
        synthesisAgentId: team.id === "synthesis" ? "orch.writing" : undefined,
      });
      return { pid, team, res };
    },
    onSuccess: ({ team, res }) => {
      setActiveFleetId(res.fleetId);
      toast.ok(`已发起 ${team.name}（已入队 ${res.state.enqueuedIndexes?.length ?? res.jobs.length}）`);
      void qc.invalidateQueries({ queryKey: ["fleet", res.fleetId] });
      void qc.invalidateQueries({ queryKey: ["fleets", effectiveProjectId] });
    },
    onError: (e: Error) => toast.fail(e.message),
  });

  const confirmMerge = useMutation({
    mutationFn: (accept: boolean) =>
      api.confirmFleetMerge(activeFleetId!, { accept, note: mergeNote }),
    onSuccess: (state) => {
      void qc.setQueryData(["fleet", activeFleetId], state);
      void qc.invalidateQueries({ queryKey: ["fleets", effectiveProjectId] });
      toast.ok(
        state.humanMerge?.accepted
          ? `已确认合并${state.mergedArtifactId ? "并落盘" : ""}`
          : "已拒绝合并",
      );
    },
    onError: (e: Error) => toast.fail(e.message),
  });

  const approve = useMutation({
    mutationFn: (id: string) => api.approveProposal(id),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["proposals"] });
      toast.ok(res.jobId ? "已开始执行这项建议" : "已采纳这条建议");
      if (res.jobId) {
        const unsub = subscribeJobEvents(res.jobId, {
          onEvent: () => {},
          onDone: (ev) => {
            toast.ok(`这项任务已结束 · ${ev.status ?? "完成"}`);
            unsub();
          },
          onError: () => unsub(),
        });
      }
      const pid = res.projectId || effectiveProjectId;
      if (pid) {
        const fmt = projects.find((p) => p.id === pid)?.format || "manju";
        void nav({
          to: "/studio/$format",
          params: { format: fmt },
          search: { projectId: pid },
        });
      }
    },
    onError: (e: Error) => toast.fail(e.message),
  });
  const dismiss = useMutation({
    mutationFn: (id: string) => api.dismissProposal(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["proposals"] });
      toast.info("已忽略这条建议");
    },
  });

  const pending = proposals.filter((p) => p.status === "pending");
  const fleet = fleetQuery.data;
  const fleetHistory = fleetsQuery.data?.fleets ?? [];

  return (
    <div className={embedded ? "colleague-embed" : "page page--wide"}>
      {!embedded ? (
        <PageHeader
          title="AI 同事"
          description="AI 同事会主动帮你想下一步该做什么；真正开始写稿前，一定先问过你。"
          actions={
            <Button variant="primary" onClick={() => scan.mutate()} disabled={scan.isPending}>
              {scan.isPending ? "检查中…" : "看看下一步做什么"}
            </Button>
          }
        />
      ) : (
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <strong>舰队 / 提议</strong>
          <Button variant="primary" size="sm" onClick={() => scan.mutate()} disabled={scan.isPending}>
            {scan.isPending ? "检查中…" : "看看下一步做什么"}
          </Button>
        </div>
      )}

      <Panel title="选择要协作的项目" style={{ marginTop: embedded ? 0 : 14 }}>
        <label className="field">
          <span>项目</span>
          <Select
            className="select"
            value={projectId}
            onChange={(e) => {setAdviser("");setProjectId(e.target.value);setActiveFleetId(null);}}
          >
            <option value="">请选择项目</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </Select>
        </label>
        {advisers.data?.agents.some(a=>a.custom) && <label>附加知识顾问 <select value={adviser} onChange={e=>setAdviser(e.target.value)}>
          <option value="">无</option>{advisers.data.agents.filter(a=>a.custom).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
        </select></label>}
      </Panel>

      <div className="grid grid-3" style={{ marginTop: 14 }}>
        {TEAMS.map((t) => (
          <div key={t.id} className="pkg-card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>{t.name}</strong>
              <Badge tone="ok">协作组</Badge>
            </div>
            <p>{t.desc}</p>
            <p className="faint" style={{ fontSize: "var(--fs-sm)" }}>
              {t.members.length} 位助手 ·{" "}
              {t.mergePolicy === "semantic_repair" ? "自动整理建议" : "需要你确认"}
              {t.id === "ordered" ? " · 按顺序" : " · 同时进行"}
            </p>
            <Button
              variant="primary"
              disabled={launchTeam.isPending || !effectiveProjectId}
              onClick={() => launchTeam.mutate(t)}
            >
              开始协作
            </Button>
          </div>
        ))}
      </div>

      {effectiveProjectId && (
        <Panel
          title="协作记录"
          style={{ marginTop: 16 }}
          actions={<Badge>{fleetHistory.length}</Badge>}
        >
          <div className="stack scroll-region compact-scroll-region">
            {fleetHistory.map((f) => (
              <div key={f.planId} className="row" style={{ justifyContent: "space-between" }}>
                <div className="row">
                  <Badge>协作组</Badge>
                  <span className="faint" style={{ fontSize: "var(--fs-sm)" }}>查看进度</span>
                  {f.awaitingHumanMerge && <Badge tone="warn">待合并</Badge>}
                  {f.mergedArtifactId && <Badge tone="ok">已落盘</Badge>}
                </div>
                <Button
                  onClick={() => {
                    setActiveFleetId(f.planId);
                    void qc.invalidateQueries({ queryKey: ["fleet", f.planId] });
                  }}
                >
                  查看
                </Button>
              </div>
            ))}
            {!fleetHistory.length && <div className="empty">还没有协作记录</div>}
          </div>
        </Panel>
      )}

      {activeFleetId && (
        <Panel
          title="协作进度"
          style={{ marginTop: 16 }}
          actions={<Badge tone="warn">{fleetStatusLabel(fleet)}</Badge>}
        >
          <div className="stack scroll-region panel-scroll-region">
            {fleet?.format && (
              <span className="faint" style={{ fontSize: "var(--fs-sm)" }}>
                已完成 {fleet.reports?.filter((r) => r.status === "done").length || 0} /{" "}
                {fleet.reports?.length || 0} 位助手
              </span>
            )}
            {(fleet?.reports || []).map((r) => {
              const live = r.jobId ? liveByJob[String(r.jobId)] : "";
              return (
                <div key={`${r.index}-${r.name}`} className="stack" style={{ gap: 4 }}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <div className="row">
                      <Badge>{r.name}</Badge>
                      <Badge
                        tone={
                          r.status === "done" ? "ok" : r.status === "failed" ? "fail" : "warn"
                        }
                      >
                        {r.status === "done" ? "完成" : r.status === "failed" ? "失败" : r.status === "running" ? "进行中" : "等待"}
                      </Badge>
                    </div>
                    <span className="faint" style={{ fontSize: "var(--fs-sm)", maxWidth: "50%" }}>
                      {(r.summary || "").slice(0, 80)}
                    </span>
                  </div>
                  {live ? (
                    <pre
                      style={{
                        margin: 0,
                        fontSize: "var(--fs-sm)",
                        whiteSpace: "pre-wrap",
                        maxHeight: 72,
                        overflow: "auto",
                        opacity: 0.85,
                      }}
                    >
                      {live}
                    </pre>
                  ) : null}
                </div>
              );
            })}
            {fleet?.mergeMarkdown && (
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  fontSize: "var(--fs-sm)",
                  margin: 0,
                  maxHeight: 220,
                  overflow: "auto",
                }}
              >
                {fleet.mergeMarkdown}
              </pre>
            )}
            {fleet?.awaitingHumanMerge && (
              <div className="stack">
                <label className="field">
                  <span>合并说明（可选）</span>
                  <input
                    className="input"
                    value={mergeNote}
                    onChange={(e) => setMergeNote(e.target.value)}
                    placeholder="确认或拒绝原因"
                  />
                </label>
                <div className="row">
                  <Button
                    variant="primary"
                    disabled={confirmMerge.isPending}
                    onClick={() => confirmMerge.mutate(true)}
                  >
                    确认合并
                  </Button>
                  <Button disabled={confirmMerge.isPending} onClick={() => confirmMerge.mutate(false)}>
                    拒绝
                  </Button>
                </div>
              </div>
            )}
            {!fleet && fleetQuery.isLoading && <div className="faint">正在加载协作进度…</div>}
          </div>
        </Panel>
      )}

      <div className="stack" style={{ marginTop: 16 }}>
        <Panel
          title="待你确认的建议"
          actions={<Badge tone="warn">{pending.length} 条待确认</Badge>}
        >
          <div className="stack scroll-region list-scroll-region">
            {proposals.map((p) => (
              <div
                key={p.id}
                className="pkg-card slide-in"
                style={p.status === "pending" ? { borderColor: "var(--accent)" } : undefined}
              >
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div className="row">
                    <Badge>{p.type}</Badge>
                    <Badge
                      tone={
                        p.status === "pending" ? "warn" : p.status === "approved" ? "ok" : "default"
                      }
                    >
                      {p.status}
                    </Badge>
                  </div>
                  <span className="faint">{new Date(p.createdAt).toLocaleString()}</span>
                </div>
                <p style={{ margin: "10px 0", fontSize: "var(--fs-sm)" }}>{p.message}</p>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div className="row" style={{ gap: 4 }}>
                    {p.actions.map((a) => (
                      <Badge key={a.actionId}>
                        {a.label}
                        {a.needsApproval ? " · 需批准" : ""}
                      </Badge>
                    ))}
                  </div>
                  {p.status === "pending" && (
                    <div className="row">
                      <Button variant="primary" onClick={() => approve.mutate(p.id)}>
                        批准
                      </Button>
                      <Button onClick={() => dismiss.mutate(p.id)}>忽略</Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {!proposals.length && (
              <div className="empty">暂无提议。点右上角「立即扫描缺口」或等待定时任务。</div>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
