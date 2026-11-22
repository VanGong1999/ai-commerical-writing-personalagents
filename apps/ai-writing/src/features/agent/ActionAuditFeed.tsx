import { Badge, Button, toast } from "@xiezuomanju/ui";
import { RefreshCw, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type AuditAction, type InstanceMetrics } from "../../api/client";

const ACTOR_LABEL = (actor: string) => {
  if (actor === "assistant" || actor === "chief") return "总编";
  if (actor === "eggbot") return "蛋博士";
  if (actor.startsWith("bot:")) return "同事";
  if (actor === "user") return "你";
  return actor;
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString();
}

type Props = { onChanged?: () => void };

/**
 * 代操作审计 + 实例指标：Personal Agent / Bot 替你操作系统的痕迹（可一键撤销暂停/恢复）。
 * 新出现的「代你操作」会 toast 提示；通知策略在 Bot 详情 → 信任页配置。
 */
export function ActionAuditFeed({ onChanged }: Props) {
  const [items, setItems] = useState<AuditAction[]>([]);
  const [metrics, setMetrics] = useState<InstanceMetrics | null>(null);
  const seen = useRef<Set<string> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [a, m] = await Promise.all([
        api.listAuditActions({ limit: 20 }),
        api.getInstanceMetrics().catch(() => null),
      ]);
      setItems(a.actions || []);
      setMetrics(m);
      const prev = seen.current;
      if (prev) {
        for (const x of a.actions || []) {
          if (!prev.has(x.id) && x.onBehalfOfUser) toast.info(`${ACTOR_LABEL(x.actor)}已代你操作：${x.summary}`);
        }
      }
      seen.current = new Set((a.actions || []).map((x) => x.id));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 6000);
    return () => clearInterval(t);
  }, [refresh]);

  const undo = (a: AuditAction) => {
    if (!a.undo) return;
    const fn = a.undo.action === "agent_resume" ? api.resumeTaskRun : api.pauseTaskRun;
    void fn(a.undo.runId)
      .then(() => {
        toast.info("已撤销");
        void refresh();
        onChanged?.();
      })
      .catch((e) => toast.fail(String(e)));
  };

  return (
    <section className="daemon-audit" style={{ marginTop: 16 }}>
      <header className="row" style={{ gap: 8, alignItems: "center", justifyContent: "space-between" }}>
        <strong>代操作审计</strong>
        <div className="row" style={{ gap: 6 }}>
          {metrics ? (
            <>
              <Badge tone="default">实例 {metrics.total}</Badge>
              {metrics.retried > 0 ? <Badge tone="warn">重试 {metrics.retried}</Badge> : null}
              {metrics.dead > 0 ? <Badge tone="warn">死亡 {metrics.dead}</Badge> : null}
              {metrics.leaseExpiring > 0 ? <Badge tone="warn">租约将过期 {metrics.leaseExpiring}</Badge> : null}
            </>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => void refresh()}>
            <RefreshCw size={14} />
          </Button>
        </div>
      </header>
      {items.length === 0 ? (
        <div className="empty">暂无代操作记录。总编/蛋博士替你暂停、恢复、停止任务或写记忆时会出现在这里。</div>
      ) : (
        <ul className="stack" style={{ gap: 6, marginTop: 8 }}>
          {items.map((a) => (
            <li key={a.id} className="row" style={{ gap: 8, alignItems: "center" }}>
              <span className="faint">{fmtTime(a.createdAt)}</span>
              <Badge tone={a.onBehalfOfUser ? "ok" : "default"}>{ACTOR_LABEL(a.actor)}</Badge>
              <span style={{ flex: 1 }}>{a.summary}</span>
              {a.undo ? (
                <Button size="sm" variant="ghost" onClick={() => undo(a)}>
                  <Undo2 size={13} /> 撤销
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
