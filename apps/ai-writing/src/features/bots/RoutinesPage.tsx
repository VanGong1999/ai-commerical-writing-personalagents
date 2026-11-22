import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, PageHeader, Panel, toast } from "@xiezuomanju/ui";
import { useMemo, useState } from "react";
import { api, type RosterColleague } from "../../api/client";
import { colleagueBotId } from "./rosterBot";
import { RoutinesPanel } from "../colleague/RoutinesPanel";

type RoutineRow = {
  id: string;
  name: string;
  cronOrInterval: string;
  enabled: boolean;
  botId?: string | null;
  runCount?: number;
  lastCostTokens?: number;
  description?: string | null;
  prompt?: string | null;
};

function RoutinePromptCell({
  id,
  initial,
  onSaved,
}: {
  id: string;
  initial: string;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [open, setOpen] = useState(false);
  const save = useMutation({
    mutationFn: () => api.patchScheduledPrompt(id, { prompt: draft }),
    onSuccess: () => {
      toast.ok("已保存例程提示词");
      setOpen(false);
      onSaved();
    },
    onError: (e: Error) => toast.fail(e.message),
  });

  if (!open) {
    return (
      <button type="button" className="routine-prompt-preview" onClick={() => setOpen(true)}>
        {initial ? (initial.length > 48 ? `${initial.slice(0, 48)}…` : initial) : "（点击编辑）"}
      </button>
    );
  }

  return (
    <div className="stack" style={{ gap: 6, minWidth: 220 }}>
      <textarea
        className="input"
        rows={3}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="例程每次触发时附加给同事的指令…"
      />
      <div className="row" style={{ gap: 6 }}>
        <Button size="sm" variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>
          保存
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setDraft(initial);
            setOpen(false);
          }}
        >
          取消
        </Button>
      </div>
    </div>
  );
}

export function RoutinesPage({
  embedded = false,
  colleagues = [],
}: {
  embedded?: boolean;
  colleagues?: RosterColleague[];
}) {
  const qc = useQueryClient();
  const scheduledQ = useQuery({
    queryKey: ["scheduled-tasks"],
    queryFn: () => api.listScheduled(),
  });
  const projectsQ = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects({}),
  });

  const nameByBotId = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of colleagues) m.set(colleagueBotId(c), c.displayName || c.name);
    return m;
  }, [colleagues]);

  const rows = useMemo(() => {
    const list = (scheduledQ.data || []) as Array<
      RoutineRow & { botId?: string | null; lastCostTokens?: number; runCount?: number }
    >;
    return list
      .filter((t) => Boolean(t.botId))
      .map((t) => ({
        id: t.id,
        name: t.name,
        cronOrInterval: t.cronOrInterval,
        enabled: t.enabled,
        botId: t.botId,
        runCount: t.runCount,
        lastCostTokens: t.lastCostTokens,
        description: t.description,
        prompt: (t as { prompt?: string | null }).prompt ?? "",
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }, [scheduledQ.data]);

  const botName = (id?: string | null) => nameByBotId.get(id || "") || id || "—";

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patchScheduled(id, enabled),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["scheduled-tasks"] });
      toast.ok("已更新例程状态");
    },
    onError: (e: Error) => toast.fail(e.message),
  });

  const content = (
    <>
      <Panel title="同事例程" style={{ marginTop: embedded ? 0 : 14 }} actions={<Badge>{rows.length}</Badge>}>
        <table className="table">
          <thead>
            <tr>
              <th>名称</th>
              <th>同事</th>
              <th>计划</th>
              <th>提示词</th>
              <th>运行</th>
              <th>上次成本</th>
              <th>状态</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>{r.name}</strong>
                  {r.description ? (
                    <div className="faint" style={{ fontSize: "var(--fs-2xs)" }}>
                      {r.description}
                    </div>
                  ) : null}
                </td>
                <td>{botName(r.botId)}</td>
                <td>
                  <code>{r.cronOrInterval}</code>
                </td>
                <td>
                  <RoutinePromptCell
                    id={r.id}
                    initial={r.prompt || ""}
                    onSaved={() => void qc.invalidateQueries({ queryKey: ["scheduled-tasks"] })}
                  />
                </td>
                <td>{r.runCount ?? 0}</td>
                <td>{(r.lastCostTokens ?? 0).toLocaleString()} tokens</td>
                <td>
                  <Badge tone={r.enabled ? "ok" : "default"}>
                    {r.enabled ? "开启" : "关闭"}
                  </Badge>
                </td>
                <td>
                  <Button
                    size="sm"
                    disabled={toggle.isPending}
                    onClick={() => toggle.mutate({ id: r.id, enabled: !r.enabled })}
                  >
                    {r.enabled ? "停用" : "启用"}
                  </Button>
                </td>
              </tr>
            ))}
            {!rows.length && !scheduledQ.isLoading && (
              <tr>
                <td colSpan={8}>
                  <div className="empty">还没有绑定同事的例程。可从「蛋博士」或编组预设导入。</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Panel>

      <RoutinesPanel projects={projectsQ.data ?? []} />
    </>
  );

  if (embedded) {
    return <div className="stack">{content}</div>;
  }

  return (
    <div className="page page--wide">
      <PageHeader
        title="例程"
        description="按同事维度查看定时任务，可启停、编辑提示词并查看累计成本。"
      />
      {content}
    </div>
  );
}