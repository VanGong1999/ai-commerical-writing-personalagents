import type { Artifact, ProjectFormat } from "@xiezuomanju/domain";
import {
  Badge,
  Button,
  CollapsibleSection,
  DiffCompare,
  GateBadgeList,
  MarkdownDocument,
  StreamPanel,
  toast,
} from "@xiezuomanju/ui";
import { Select } from "@xiezuomanju/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import { useAgentRun } from "./useAgentRun";
import { usePersistedState } from "./usePersistedState";

type GateKey = "logic" | "aiTone" | "camera" | "voice" | "hook";

const GATES: { key: GateKey; label: string }[] = [
  { key: "logic", label: "逻辑：纲 ↔ 文同步，无硬伤" },
  { key: "aiTone", label: "AI 表述：去套话排比" },
  { key: "camera", label: "镜头语言：可拍、少形容词" },
  { key: "voice", label: "人设台词：口吻不串戏" },
  { key: "hook", label: "钩 / 伏笔：集尾能留住人" },
];

const DEAI_CHECKS: { key: string; label: string }[] = [
  { key: "cliche", label: "去掉套话排比（缓缓 / 仿佛 / 那一刻）" },
  { key: "dialogue", label: "对话口语化，不书面腔" },
  { key: "visual", label: "镜头可拍，动作可执行" },
  { key: "rhythm", label: "节奏不匀速注水" },
];

const EMPTY_GATES: Record<GateKey, boolean> = {
  logic: false,
  aiTone: false,
  camera: false,
  voice: false,
  hook: false,
};

const EMPTY_DEAI: Record<string, boolean> = {
  cliche: false,
  dialogue: false,
  visual: false,
  rhythm: false,
};

function artifactText(artifact: Artifact | undefined) {
  if (!artifact) return "";
  if (artifact.bodyMarkdown?.trim()) return artifact.bodyMarkdown.trim();
  // duanju 场级正文：正文在 script_body
  if (artifact.type === "scene") {
    const sb = (artifact.bodyJson as { script_body?: string } | null | undefined)?.script_body;
    if (sb?.trim()) return sb.trim();
  }
  const body = artifact.bodyJson as
    | { scenes?: { visual?: string; dialogue?: string }[] }
    | null
    | undefined;
  return (body?.scenes ?? [])
    .map((scene) => `画面：${scene.visual ?? ""}\n台词：${scene.dialogue ?? ""}`)
    .join("\n\n")
    .trim();
}

function textLength(text: string) {
  return text.replace(/\s+/g, "").length;
}

/**
 * 去 AI 味质检工作台（九格：五维精修门禁 + 去 AI 味自查）。
 * 同时供「交稿物 qc」与「漫剧 S9_DE_AI」使用，避免重复实现。
 */
export function DeAiWorkbench({ projectId, format }: { projectId?: string; format?: ProjectFormat }) {
  const qc = useQueryClient();
  const { data: artifacts = [] } = useQuery({
    queryKey: ["artifacts", projectId],
    queryFn: () => api.listArtifacts(projectId!),
    enabled: !!projectId,
  });
  const manuscripts = useMemo(
    () =>
      artifacts
        .filter((artifact) =>
          format === "duanju" ? artifact.type === "scene" : artifact.type === "manuscript",
        )
        .sort(
          (a, b) =>
            Number((b.bodyJson as { episodeNo?: number } | null)?.episodeNo ?? 0) -
            Number((a.bodyJson as { episodeNo?: number } | null)?.episodeNo ?? 0),
        ),
    [artifacts, format],
  );
  const qcReports = useMemo(
    () =>
      artifacts
        .filter((artifact) => artifact.type === "qc_report")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [artifacts],
  );

  const [sourceId, setSourceId] = useState("");
  const [sourceText, setSourceText] = useState("");

  useEffect(() => {
    if (!manuscripts.length) {
      if (sourceId) setSourceId("");
      return;
    }
    if (manuscripts.some((artifact) => artifact.id === sourceId)) return;
    setSourceId(manuscripts[0].id);
  }, [manuscripts, sourceId]);

  useEffect(() => {
    const source = manuscripts.find((artifact) => artifact.id === sourceId);
    setSourceText(artifactText(source));
  }, [manuscripts, sourceId]);

  const [gates, setGates] = usePersistedState<Record<GateKey, boolean>>(
    projectId,
    `qc-gates:${sourceId || "manual"}`,
    EMPTY_GATES,
  );
  const [deai, setDeai] = usePersistedState<Record<string, boolean>>(
    projectId,
    `qc-deai:${sourceId || "manual"}`,
    EMPTY_DEAI,
  );
  const stream = useAgentRun(projectId, "qc.de_ai");

  const passed = GATES.filter((gate) => gates[gate.key]).length;
  const deaiPassed = DEAI_CHECKS.filter((check) => deai[check.key]).length;
  const latestReport = qcReports[0];
  const sourceLabel =
    sourceId.length > 0
      ? `第${
          Number(
            (manuscripts.find((artifact) => artifact.id === sourceId)?.bodyJson as
              | { episodeNo?: number }
              | null)?.episodeNo ?? 0,
          ) || "?"
        }集`
      : "手动文本";

  const gateChecks = GATES.map((gate) => ({
    id: gate.key,
    name: gate.label,
    result: gates[gate.key] ? ("pass" as const) : ("warn" as const),
    message: gates[gate.key] ? "已确认" : "待人工确认",
  }));

  const adoptReport = async () => {
    if (!projectId || !latestReport) return;
    try {
      await api.adoptArtifact(projectId, latestReport.id, "strong");
      await qc.invalidateQueries({ queryKey: ["artifacts", projectId] });
      toast.ok("质检稿已采纳，交稿物状态已更新");
    } catch (error) {
      toast.fail(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="stack">
      <CollapsibleSection
        title="质检对象"
        badge={sourceLabel}
        summary={`${textLength(sourceText)} 字`}
        storageKey={projectId ? `qc-source-${projectId}` : undefined}
      >
        <div className="qc-sourcebar">
          <Select
            className="select"
            value={sourceId}
            aria-label="选择要质检的正文"
            onChange={(event) => setSourceId(event.target.value)}
          >
            {!manuscripts.length ? <option value="">暂无已保存正文</option> : null}
            {manuscripts.map((artifact) => {
              const body = artifact.bodyJson as
                | { episodeNo?: number; wordCount?: number }
                | null;
              return (
                <option key={artifact.id} value={artifact.id}>
                  第{body?.episodeNo ?? "?"}集 · {body?.wordCount ?? textLength(artifactText(artifact))} 字
                </option>
              );
            })}
          </Select>
          <Badge tone={sourceText ? "ok" : "warn"}>{textLength(sourceText)} 字</Badge>
        </div>
        <textarea
          className="textarea qc-source-text"
          rows={7}
          value={sourceText}
          placeholder="先在「分集正文」保存一版正文，或直接粘贴待质检文本。"
          onChange={(event) => setSourceText(event.target.value)}
        />
        <p className="muted" style={{ margin: "6px 0 0", fontSize: 11 }}>
          质检会以当前文本生成 qc_report；采纳后才计入交稿包完成度。
        </p>
      </CollapsibleSection>

      <CollapsibleSection
        title="五维精修门禁"
        badge={`${passed}/${GATES.length}`}
        summary={passed === GATES.length ? "人工确认完成" : "需逐项确认"}
        storageKey={projectId ? `qc-gates-panel-${projectId}` : undefined}
      >
        <GateBadgeList checks={gateChecks} />
        <div className="stack qc-checklist">
          {GATES.map((gate) => (
            <label key={gate.key} className="row">
              <input
                type="checkbox"
                checked={gates[gate.key]}
                onChange={(event) =>
                  setGates((state) => ({ ...state, [gate.key]: event.target.checked }))
                }
              />
              <span>{gate.label}</span>
            </label>
          ))}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="去 AI 味自查"
        badge={`${deaiPassed}/${DEAI_CHECKS.length}`}
        summary={deaiPassed === DEAI_CHECKS.length ? "自查完成" : "检查套话与节奏"}
        storageKey={projectId ? `qc-deai-panel-${projectId}` : undefined}
      >
        <div className="stack qc-checklist">
          {DEAI_CHECKS.map((check) => (
            <label key={check.key} className="row">
              <input
                type="checkbox"
                checked={Boolean(deai[check.key])}
                onChange={(event) =>
                  setDeai((state) => ({ ...state, [check.key]: event.target.checked }))
                }
              />
              <span>{check.label}</span>
            </label>
          ))}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="前后对照"
        badge={stream.text ? `${textLength(stream.text)} 字` : "待生成"}
        summary="AI 原稿 ↔ 去味稿"
        storageKey={projectId ? `qc-diff-${projectId}` : undefined}
      >
        <DiffCompare
          leftTitle="AI 原稿"
          rightTitle="去味稿"
          left={sourceText || "（暂无正文）"}
          right={stream.text || "（生成结果将显示在此）"}
        />
      </CollapsibleSection>

      <StreamPanel
        text={stream.text}
        streaming={stream.streaming}
        onStart={() =>
          void stream.start({
            inputJson: { text: sourceText, checklist: deai, gates },
            label: "qc.de_ai",
            onEvent: (event) => {
              if (event.type === "done" || event.status === "failed") {
                void qc.invalidateQueries({ queryKey: ["artifacts", projectId] });
              }
            },
          })
        }
        onAbort={() => void stream.abort()}
      />

      {latestReport ? (
        <CollapsibleSection
          title="最新质检稿"
          badge={latestReport.status === "adopted" ? "已采纳" : "待采纳"}
          summary={new Date(latestReport.createdAt).toLocaleString()}
          defaultOpen={false}
          storageKey={projectId ? `qc-report-${projectId}` : undefined}
        >
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
            <span className="faint" style={{ fontSize: 11 }}>
              {latestReport.title} · {textLength(artifactText(latestReport))} 字
            </span>
            <Button
              variant={latestReport.status === "adopted" ? "default" : "primary"}
              size="sm"
              disabled={latestReport.status === "adopted"}
              onClick={() => void adoptReport()}
            >
              {latestReport.status === "adopted" ? "已采纳" : "采纳质检稿"}
            </Button>
          </div>
          <div className="qc-report-preview">
            <MarkdownDocument source={artifactText(latestReport) || "（质检结果为空）"} />
          </div>
        </CollapsibleSection>
      ) : (
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          运行「去 AI 味」后会生成可采纳的质检稿。
        </p>
      )}

      {stream.error ? (
        <p className="muted" style={{ color: "var(--danger)" }}>
          {stream.error}
        </p>
      ) : null}
      {!projectId ? <p className="muted">缺少 projectId，无法入队</p> : null}
    </div>
  );
}
