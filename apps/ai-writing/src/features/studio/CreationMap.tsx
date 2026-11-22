import { useQuery } from "@tanstack/react-query";
import type { ProjectFormat } from "@xiezuomanju/domain";
import { Button, Panel } from "@xiezuomanju/ui";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { api } from "../../api/client";
import { PulseDot, Stagger, StaggerItem } from "../../components/motion";
import { labelsFor } from "./stageConfig";

export type StageGraphNode = {
  id: string;
  name: string;
  agentIds: string[];
  next: string[];
  requiresUserAck?: boolean;
};

type Props = {
  format: ProjectFormat;
  currentStageId?: string;
  completed?: string[];
  onSelectStage?: (stageId: string) => void;
  onRunAgent?: (agentId: string) => void | Promise<void>;
  compact?: boolean;
};

export function CreationMap({
  format,
  currentStageId,
  completed = [],
  onSelectStage,
  onRunAgent,
  compact,
}: Props) {
  const labels = labelsFor(format);
  const { data, isLoading, error } = useQuery({
    queryKey: ["stage-graph", format],
    queryFn: () => api.getStageGraph(format),
  });

  const stages: StageGraphNode[] = data?.stages ?? [];
  const done = new Set(completed);
  const current = stages.find((s) => s.id === currentStageId);
  const currentAgents = current?.agentIds ?? [];
  const agentsKey = currentAgents.join(",");
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(
    () => new Set(currentAgents),
  );
  const [selectedKey, setSelectedKey] = useState(agentsKey);
  const [runningAgents, setRunningAgents] = useState<Set<string>>(new Set());
  const [batchRunning, setBatchRunning] = useState(false);

  // 切换当前步骤时，重置为「全选该步骤的助手」
  useEffect(() => {
    if (selectedKey !== agentsKey) {
      setSelectedKey(agentsKey);
      setSelectedAgents(new Set(currentAgents));
    }
  }, [agentsKey, selectedKey, currentAgents]);

  const toggle = (agentId: string) => {
    setSelectedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  };

  const runBatch = async () => {
    if (!onRunAgent || selectedAgents.size === 0) return;
    setBatchRunning(true);
    for (const agentId of currentAgents) {
      if (!selectedAgents.has(agentId)) continue;
      setRunningAgents((prev) => new Set(prev).add(agentId));
      try {
        await onRunAgent(agentId);
      } catch {
        /* StudioPage 已 toast */
      }
      setRunningAgents((prev) => {
        const next = new Set(prev);
        next.delete(agentId);
        return next;
      });
    }
    setBatchRunning(false);
  };

  if (isLoading) return <div className="muted">加载创作地图…</div>;
  if (error || !stages.length) {
    return (
      <div className="muted">
        暂无流程信息。{error ? String(error) : ""}
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: compact ? 8 : 12 }}>
      {!compact && (
        <p className="page-desc" style={{ margin: 0 }}>
          点节点切换步骤；需人工确认的步骤带锁。当前步骤可勾选要跑的 AI 助手，一键批量运行。
        </p>
      )}
      <motion.div
        initial={{ scaleX: 0, opacity: 0 }}
        animate={{ scaleX: 1, opacity: 1 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        style={{
          height: 2,
          transformOrigin: "left",
          background: "linear-gradient(90deg, var(--accent, #6366f1), transparent)",
          borderRadius: 2,
        }}
        aria-hidden
      />
      <Stagger className="map" style={compact ? { gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))" } : undefined}>
        {stages.map((s, i) => {
          const active = s.id === currentStageId;
          const isDone = done.has(s.id);
          const prev = i > 0 ? stages[i - 1] : undefined;
          return (
            <StaggerItem key={s.id}>
              <button
                type="button"
                className="map__node"
                data-active={active}
                data-done={isDone}
                onClick={() => onSelectStage?.(s.id)}
                style={{ textAlign: "left", cursor: "pointer" }}
              >
                <strong className="row" style={{ gap: 6, alignItems: "center" }}>
                  <PulseDot
                    active={active}
                    tone={isDone ? "ok" : active ? "accent" : "warn"}
                    size={8}
                  />
                  {i + 1}. {labels[s.id] || s.name}
                </strong>
              <span className="faint">
                {prev ? `← ${labels[prev.id] || prev.name}` : "起点"}
              </span>
              <span className="faint">
                {s.requiresUserAck ? "需人工确认 · " : ""}
                {s.agentIds.length ? `${s.agentIds.length} 位 AI 助手` : "需要你确认"}
              </span>
              </button>
            </StaggerItem>
          );
        })}
      </Stagger>

      {currentStageId && (
        <Panel
          title={`当前 · ${labels[currentStageId] || currentStageId}`}
          actions={
            currentAgents.length > 0 && onRunAgent ? (
              <Button
                size="sm"
                variant="primary"
                disabled={selectedAgents.size === 0 || batchRunning}
                onClick={() => void runBatch()}
              >
                {batchRunning ? "运行中…" : `运行勾选 (${selectedAgents.size})`}
              </Button>
            ) : undefined
          }
        >
          {currentAgents.length === 0 ? (
            <p className="muted">这一步需要你确认或挑选稿件，确认后再继续。</p>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {currentAgents.map((aid) => {
                const checked = selectedAgents.has(aid);
                const running = runningAgents.has(aid);
                return (
                  <div key={aid} className="agent-task-row">
                    <input
                      type="checkbox"
                      checked={checked}
                      aria-label={`选择 ${aid}`}
                      onChange={() => toggle(aid)}
                    />
                    <code className="agent-task-row__id">{aid}</code>
                    {onRunAgent && (
                      <Button
                        size="sm"
                        variant={checked ? "primary" : "ghost"}
                        disabled={running}
                        onClick={() => void onRunAgent(aid)}
                      >
                        {running ? "运行中" : "入队运行"}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
