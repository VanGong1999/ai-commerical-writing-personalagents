import { focusManager, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Tabs, toast } from "@xiezuomanju/ui";
import { Pin, PinOff } from "lucide-react";
import {KnowledgeScopeFields} from "./KnowledgeScopeFields";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { api, type Bot, type NotifyPolicy } from "../../api/client";
import { formatCnYuan } from "../../lib/format";

const TRUST_LABELS = ["只读", "提议", "可逆操作", "自主+否决窗"];
const STAGE_LABELS: Record<string, string> = {
  watched: "旁观",
  saved: "已保存",
  one_shot: "试跑",
  routine: "例程化",
};
const USAGE_REFRESH_MS = 10_000;
const subscribeToPageVisibility = (onChange: () => void) => focusManager.subscribe(onChange);
const isPageVisible = () => focusManager.isFocused();

export function BotDetailPanel({
  bot,
  onUpdated, projectId,
}: {
  bot: Bot | null;
  projectId?:string;
  onUpdated?: (bot: Bot) => void;
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState("identity");
  const pageVisible = useSyncExternalStore(subscribeToPageVisibility, isPageVisible);

  const [execution,setExecution]=useState<NonNullable<Bot["execution"]>>({});
  useEffect(()=>setExecution(bot?.execution || {}),[bot?.id,bot?.execution]);
  const [routinePrompt,setRoutinePrompt]=useState("");
  const [routineSchedule,setRoutineSchedule]=useState("1d");
  const createRoutine=useMutation({mutationFn:()=>api.createScheduled({
    name:`${bot!.name}项目例程`,cronOrInterval:routineSchedule,enabled:true,botId:bot!.id,prompt:routinePrompt.trim(),
    payloadTemplate:{type:"bot.routine",bot_id:bot!.id,project_id:projectId},
  }),onSuccess:()=>{setRoutinePrompt("");void qc.invalidateQueries({queryKey:["bot-routines",bot?.id]});toast.ok("已创建项目例程");},
  onError:(e:Error)=>toast.fail(e.message)});
  const skillsQ = useQuery({
    queryKey: ["bot-skills", bot?.id],
    queryFn: () => api.listBotSkills(bot!.id),
    enabled: Boolean(bot?.id),
  });
  const routinesQ = useQuery({
    queryKey: ["bot-routines", bot?.id],
    queryFn: () => api.listBotRoutines(bot!.id),
    enabled: Boolean(bot?.id),
  });
  const memoriesQ = useQuery({
    queryKey: ["bot-memories", bot?.id,projectId],
    queryFn: () => api.listBotMemories(bot!.id,projectId),
    enabled: Boolean(bot?.id),
  });
  const usageQ = useQuery({
    queryKey: ["bot-usage", bot?.id],
    queryFn: () => api.getBotUsage(bot!.id, 7),
    enabled: Boolean(bot?.id) && tab === "usage" && pageVisible,
    staleTime: 0,
    refetchInterval: USAGE_REFRESH_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    // Let the next visible poll retry, without queuing a fetch while offline.
    networkMode: "always",
    retry: false,
  });

  const pinMut = useMutation({
    mutationFn: (pinned: boolean) => api.pinBot(bot!.id, pinned),
    onSuccess: (b) => {
      void qc.invalidateQueries({ queryKey: ["bots"] });
      onUpdated?.(b);
      toast.ok(b.pinned ? "已置顶" : "已取消置顶");
    },
    onError: (e: Error) => toast.fail(e.message),
  });

  const patchMut = useMutation({
    mutationFn: (patch: { execution?:Bot["execution"]; trustLevel?: number; restateBeforeAct?: boolean; notifyPolicy?: NotifyPolicy }) =>
      api.patchBot(bot!.id, patch),
    onSuccess: (b) => {
      void qc.invalidateQueries({ queryKey: ["bots"] });
      onUpdated?.(b);
      void qc.invalidateQueries({queryKey:["bot-roster"]});
      toast.ok("已更新");
    },
    onError: (e: Error) => toast.fail(e.message),
  });

  const exportMut = useMutation({
    mutationFn: () => api.exportBot(bot!.id),
    onSuccess: (payload) => {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${bot!.name || bot!.id}.bot.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.ok("已导出");
    },
    onError: (e: Error) => toast.fail(e.message),
  });

  const avatarEmoji = useMemo(() => {
    if (!bot) return "?";
    return (bot.avatar?.emoji as string) || bot.name.slice(0, 1);
  }, [bot]);

  if (!bot) {
    return (
      <aside className="bots-home__detail">
        <div className="empty" style={{ padding: 16 }}>
          选择一位同事查看详情
        </div>
      </aside>
    );
  }

  const catalogBot = bot.isSystem && bot.id !== "chief" && bot.id !== "eggbot";
  return (
    <aside className="bots-home__detail">
      <div className="bots-home__detail-head">
        <div className="bots-home__detail-avatar" title={bot.name}>
          {avatarEmoji}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <strong>{bot.name}</strong>
          <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
            <Badge>{bot.roleKind}</Badge>
            <Badge tone={bot.pinned ? "ok" : "default"}>{bot.pinned ? "置顶" : "普通"}</Badge>
            {bot.isSystem ? <Badge tone="warn">系统</Badge> : null}
            {bot.restateBeforeAct ? <Badge>复述后再动手</Badge> : null}
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          aria-label={bot.pinned ? "取消置顶" : "置顶"}
          disabled={catalogBot || pinMut.isPending}
          onClick={() => pinMut.mutate(!bot.pinned)}
        >
          {bot.pinned ? <PinOff size={14} /> : <Pin size={14} />}
        </Button>
      </div>

      <Tabs
        tabs={[
          { id: "identity", label: "身份" },
          { id: "skills", label: "技能" },
          { id: "routines", label: "例程" },
          { id: "memories", label: "记忆" },
          { id: "trust", label: "信任" },
          { id: "usage", label: "用量" },
        ]}
        value={tab}
        onChange={setTab}
      />

      <div className="bots-home__detail-body scroll-region">
        {tab === "identity" ? (
          <div className="stack" style={{ gap: 8 }}>
            <p style={{ margin: 0, fontSize: "var(--fs-sm)", whiteSpace: "pre-wrap" }}>
              {bot.persona || "暂无人设"}
            </p>
            {!bot.isSystem && <><KnowledgeScopeFields value={execution} onChange={setExecution}/><Button size="sm" onClick={()=>patchMut.mutate({execution})}>保存知识范围</Button></>}
            {bot.tone ? (
              <div>
                <span className="faint">语气</span>
                <div>{bot.tone}</div>
              </div>
            ) : null}
            {bot.duties?.length ? (
              <div>
                <span className="faint">职责</span>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {bot.duties.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {bot.neverDo?.length ? (
              <div>
                <span className="faint">绝不做</span>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {bot.neverDo.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="row" style={{ gap: 6 }}>
              <Button size="sm" onClick={() => exportMut.mutate()} disabled={exportMut.isPending}>
                导出
              </Button>
            </div>
          </div>
        ) : null}

        {tab === "skills" ? (
          <div className="stack" style={{ gap: 8 }}>
            {(skillsQ.data || []).map((s) => (
              <div key={s.id} className="pkg-card" style={{ padding: 10 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>/{s.slash}</strong>
                  <Badge>{STAGE_LABELS[s.trustStage] || s.trustStage}</Badge>
                </div>
                <div className="faint" style={{ fontSize: "var(--fs-sm)" }}>
                  {s.name}
                  {s.whenToUse ? ` · ${s.whenToUse}` : ""}
                </div>
                {s.evidenceRequired ? <Badge tone="warn">需证据</Badge> : null}
              </div>
            ))}
            {!skillsQ.data?.length && !skillsQ.isLoading && (
              <div className="empty">暂无技能。可在对话中用 / 调用或沉淀。</div>
            )}
          </div>
        ) : null}

        {tab === "routines" ? (
          <div className="stack" style={{ gap: 8 }}>
            {projectId && <><label>例程指令 <input value={routinePrompt} onChange={e=>setRoutinePrompt(e.target.value)}/></label>
              <label>运行周期 <input value={routineSchedule} onChange={e=>setRoutineSchedule(e.target.value)}/></label>
              <Button disabled={!routinePrompt.trim() || createRoutine.isPending} onClick={()=>createRoutine.mutate()}>创建本项目例程</Button></>}
            {(routinesQ.data || []).map((r) => (
              <div key={r.id} className="pkg-card" style={{ padding: 10 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>{r.name}</strong>
                  <Badge tone={r.enabled ? "ok" : "default"}>{r.enabled ? "开启" : "关闭"}</Badge>
                </div>
                <div className="faint" style={{ fontSize: "var(--fs-sm)" }}>
                  {r.cronOrInterval}
                  {r.runCount != null ? ` · 已跑 ${r.runCount} 次` : ""}
                  {r.lastCostTokens != null ? ` · 上次 ${r.lastCostTokens} tokens` : ""}
                </div>
              </div>
            ))}
            {!routinesQ.data?.length && !routinesQ.isLoading && (
              <div className="empty">暂无例程</div>
            )}
          </div>
        ) : null}

        {tab === "memories" ? (
          <div className="stack" style={{ gap: 8 }}>
            {(memoriesQ.data?.files || []).map((f) => (
              <details key={f.path} className="pkg-card" style={{ padding: 10 }}>
                <summary style={{ cursor: "pointer" }}>{f.path.split("/").pop()}</summary>
                <pre
                  style={{
                    margin: "8px 0 0",
                    fontSize: "var(--fs-2xs)",
                    whiteSpace: "pre-wrap",
                    maxHeight: 160,
                    overflow: "auto",
                  }}
                >
                  {f.content || "（空）"}
                </pre>
              </details>
            ))}
            {!memoriesQ.data?.files?.length && !memoriesQ.isLoading && (
              <div className="empty">暂无记忆文件</div>
            )}
          </div>
        ) : null}

        {tab === "trust" ? (
          <div className="stack" style={{ gap: 10 }}>
            <div>
              <span className="faint">当前信任等级</span>
              <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                {[0, 1, 2, 3].map((lv) => (
                  <Button
                    key={lv}
                    size="sm"
                    variant={bot.trustLevel === lv ? "primary" : "ghost"}
                    disabled={catalogBot || patchMut.isPending}
                    onClick={() => patchMut.mutate({ trustLevel: lv })}
                  >
                    {lv} · {TRUST_LABELS[lv]}
                  </Button>
                ))}
              </div>
            </div>
            <label className="row" style={{ gap: 8 }}>
              <input
                type="checkbox"
                checked={bot.restateBeforeAct}
                disabled={catalogBot || patchMut.isPending}
                onChange={(e) => patchMut.mutate({ restateBeforeAct: e.target.checked })}
              />
              <span>动手前先复述计划（restate）</span>
            </label>
            <div className="faint" style={{ fontSize: "var(--fs-sm)" }}>
              否决窗口：{bot.vetoWindowMin} 分钟
            </div>
            <div>
              <span className="faint">代你操作后的通知（审计始终留痕）</span>
              <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                {(
                  [
                    ["important", "仅重要操作"],
                    ["all", "全部通知"],
                    ["none", "静默（只记审计）"],
                  ] as Array<[NotifyPolicy, string]>
                ).map(([val, label]) => (
                  <Button
                    key={val}
                    size="sm"
                    variant={(bot.notifyPolicy || "important") === val ? "primary" : "ghost"}
                    disabled={catalogBot || patchMut.isPending}
                    onClick={() => patchMut.mutate({ notifyPolicy: val })}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {tab === "usage" ? (
          <div className="stack" style={{ gap: 8 }}>
            {usageQ.data ? (
              <>
                {usageQ.isRefetchError ? (
                  <div className="faint" role="status">用量刷新失败，显示上次获取的数据。</div>
                ) : null}
                <div className="kpi-row" style={{ margin: 0 }}>
                  <div className="kpi">
                    <div className="kpi__value">{usageQ.data.totalTokens.toLocaleString()}</div>
                    <div className="kpi__label">近 {usageQ.data.days} 天</div>
                  </div>
                  <div className="kpi">
                    <div className="kpi__value">{formatCnYuan(usageQ.data.costEst)}</div>
                    <div className="kpi__label">估算成本</div>
                  </div>
                </div>
                {usageQ.data.weeklyTokenBudget != null ? (
                  <div className="faint" style={{ fontSize: "var(--fs-sm)" }}>
                    周预算 {usageQ.data.weeklyTokenBudget.toLocaleString()}
                    {usageQ.data.budgetRatio != null
                      ? ` · 已用 ${(usageQ.data.budgetRatio * 100).toFixed(0)}%`
                      : ""}
                  </div>
                ) : null}
              </>
            ) : usageQ.isError ? (
              <div className="faint" role="status">暂时无法加载用量，将自动重试。</div>
            ) : (
              <div className="faint">加载用量…</div>
            )}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
