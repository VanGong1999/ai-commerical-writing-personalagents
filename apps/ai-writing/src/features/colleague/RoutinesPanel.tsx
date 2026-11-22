import {
  flattenCoreHookCandidate,
  type Project,
  type ProjectFormat,
} from "@xiezuomanju/domain";
import { Badge, Button, Panel, toast } from "@xiezuomanju/ui";
import { Check, ChevronRight, Loader2, Play, X } from "lucide-react";
import { useState } from "react";
import { api, formatLabel } from "../../api/client";
import { routineCoreHookArtifacts } from "../../lib/coreHookChoices";
import { ROUTINES, stepLabel, type Routine, type RoutineStep } from "./routines";

type StepState = { label: string; status: "pending" | "running" | "done" | "failed"; error?: string };

type RunState = {
  format: ProjectFormat;
  projectId: string;
  steps: StepState[];
  busy: boolean;
  finished?: boolean;
  failed?: boolean;
  finalStage?: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RUN_TIMEOUT_MS = 20 * 60 * 1000;

async function advanceTo(
  projectId: string,
  format: ProjectFormat,
  currentStage: string,
  completed: string[],
  target: string,
): Promise<{ stage: string; completed: string[] }> {
  let stage = currentStage;
  let done = [...completed];
  for (let i = 0; i < 40; i += 1) {
    if (stage === target) break;
    const res = await api.stageLock({ format, currentStageId: stage, completed: done, action: "advance" });
    if (res.locked) {
      const acked = await api.stageLock({ format, currentStageId: stage, completed: done, action: "ack" });
      done = acked.state?.completed ?? done;
      continue;
    }
    stage = res.state?.currentStageId ?? stage;
    done = res.state?.completed ?? done;
    if ((res.nextStageIds ?? []).length === 0) break;
  }
  if (stage !== target) throw new Error(`无法推进到 ${target}（停在 ${stage}）`);
  await api.patchProject(projectId, { stage });
  return { stage, completed: done };
}

async function waitRun(runId: string, label: string) {
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  let last = null;
  for (;;) {
    last = await api.getRun(runId);
    if (["succeeded", "failed", "completed"].includes(last.status)) break;
    if (Date.now() > deadline) break;
    await sleep(3000);
  }
  if (!["succeeded", "completed"].includes(last?.status ?? "")) {
    const gates = ((last as { gateResults?: Array<{ message?: string }> })?.gateResults ?? [])
      .filter((g) => g?.message)
      .slice(-2)
      .map((g) => g.message)
      .join("；");
    throw new Error(`${label} 未成功（status=${last?.status ?? "超时"}）${gates ? `：${gates}` : ""}`);
  }
}

async function adoptLatest(projectId: string, type: string): Promise<string | null> {
  const arts = await api.listArtifacts(projectId, undefined);
  const candidates = arts
    .filter((a) => a.type === type && a.status !== "adopted")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const c of candidates) {
    try {
      await api.adoptArtifact(projectId, c.id, "strong");
      return c.title;
    } catch {
      /* 下一候选 */
    }
  }
  return null;
}

async function adoptCoreHook(projectId: string): Promise<string> {
  const arts = await api.listArtifacts(projectId, undefined);
  const hooks = routineCoreHookArtifacts(arts);
  for (const a of hooks) {
    const body = (a.bodyJson ?? {}) as Record<string, unknown>;
    const items = Array.isArray(body.items) ? (body.items as Record<string, unknown>[]) : null;
    const sources: Record<string, unknown>[] = [];
    if (items) sources.push(...items);
    else if (body.candidate && typeof body.candidate === "object") {
      sources.push(body.candidate as Record<string, unknown>);
    } else {
      sources.push(body);
    }
    for (const item of sources) {
      const flat = flattenCoreHookCandidate(item);
      if (!flat || !flat.motivation || !flat.openingStructure) continue;
      if (body.items || body.candidate) {
        const created = await api.createArtifact(projectId, {
          type: "core_hook",
          title: flat.titleHook || "核心梗候选",
          bodyJson: flat as unknown as Record<string, unknown>,
          status: "candidate",
        });
        await api.adoptArtifact(projectId, created.id, "strong");
      } else {
        await api.adoptArtifact(projectId, a.id, "strong");
      }
      return flat.titleHook || flat.coreHook;
    }
  }
  throw new Error("没有找到可强采纳的核心梗候选（缺动机/开篇结构）");
}

export function RoutinesPanel({ projects }: { projects: Project[] }) {
  const [runs, setRuns] = useState<Partial<Record<ProjectFormat, RunState>>>({});
  const [ideas, setIdeas] = useState<Partial<Record<ProjectFormat, string>>>({});

  const setRun = (format: ProjectFormat, patch: Partial<RunState>) =>
    setRuns((prev) => ({ ...prev, [format]: { ...prev[format], ...patch } as RunState }));

  const runRoutine = async (format: ProjectFormat, routine: Routine) => {
    const existingRun = runs[format];
    if (existingRun?.busy) return;

    let project = [...projects]
      .filter((p) => p.format === format)
      .sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt))[0];
    const idea = (ideas[format] || "").trim();
    if (!project) {
      project = await api.createProject({
        title: `例程·${formatLabel(format)}·${new Date().toISOString().slice(5, 16).replace(/[-T:]/g, "")}`,
        format,
        genreTags: idea ? ["例程", idea.slice(0, 32)] : ["例程"],
        market: "cn",
        startFrom: "blank",
      });
      toast.info(`已为「${formatLabel(format)}」新建例程项目`);
    }

    const steps: StepState[] = routine.steps.map((s) => ({ label: stepLabel(s), status: "pending" }));
    setRuns((prev) => ({
      ...prev,
      [format]: {
        format,
        projectId: project.id,
        steps,
        busy: true,
        finished: false,
        failed: false,
      },
    }));

    let stage = project.stage;
    let completed: string[] = [];
    try {
      for (let i = 0; i < routine.steps.length; i += 1) {
        const step: RoutineStep = routine.steps[i];
        const patchStep = (p: Partial<StepState>) =>
          setRun(format, {
            steps: steps.map((s, j) => (j === i ? { ...s, ...p } : s)),
          });
        patchStep({ status: "running" });

        if (step.kind === "advanceTo") {
          const r = await advanceTo(project.id, format, stage, completed, step.target);
          stage = r.stage;
          completed = r.completed;
        } else if (step.kind === "ack") {
          const r = await api.stageLock({
            format,
            currentStageId: stage,
            completed,
            action: "ack",
          });
          completed = r.state?.completed ?? completed;
        } else if (step.kind === "assertStage") {
          const fresh = await api.getProject(project.id);
          if (fresh.stage !== step.target) {
            throw new Error(`阶段校验失败：期望 ${step.target}，实际 ${fresh.stage}`);
          }
          stage = fresh.stage;
        } else if (step.kind === "run") {
          const before = (await api.listArtifacts(project.id, undefined)).length;
          const run = await api.createRun(project.id, step.agent, {
            inputJson: { format, ...(idea ? { idea } : {}) },
          });
          await waitRun(run.id, step.agent);
          if (step.grow) {
            const after = (await api.listArtifacts(project.id, undefined)).length;
            if (after <= before) throw new Error(`${step.agent} 成功但未产生新产物`);
          }
        } else if (step.kind === "adopt") {
          await adoptLatest(project.id, step.type);
        } else if (step.kind === "adoptCoreHook") {
          await adoptCoreHook(project.id);
        }

        patchStep({ status: "done" });
      }

      const arts = await api.listArtifacts(project.id, undefined);
      const types = new Set<string>(arts.map((a) => String(a.type)));
      const missing = (routine.expectTypes ?? []).filter((t) => !types.has(t));
      if (missing.length) {
        throw new Error(`缺少产物类型：${missing.join("、")}`);
      }
      const fresh = await api.getProject(project.id);
      setRun(format, { busy: false, finished: true, failed: false, finalStage: fresh.stage });
      toast.ok(`「${routine.label}」例程完成（${fresh.stage}）`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setRun(format, { busy: false, finished: false, failed: true });
      setRuns((prev) => ({
        ...prev,
        [format]: {
          ...(prev[format] as RunState),
          steps: (prev[format]?.steps ?? []).map((s) =>
            s.status === "running" ? { ...s, status: "failed", error: msg } : s,
          ),
        },
      }));
      toast.fail(`例程中止：${msg}`);
    }
  };

  return (
    <Panel title="例程（六格式一键闭环）" style={{ marginTop: 16 }}>
      <p className="muted" style={{ marginTop: 0, fontSize: "var(--fs-sm)" }}>
        每个例程按该格式的主线依次运行 AI 助手、自动确认人工闸并采纳产物。
        没有对应格式的项目时会先帮你新建一个。
      </p>
      <div className="grid grid-3">
        {(Object.entries(ROUTINES) as Array<[ProjectFormat, Routine]>).map(([format, routine]) => {
          const state = runs[format];
          return (
            <div key={format} className="pkg-card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>{routine.label}</strong>
                <Badge tone={state?.finished ? "ok" : state?.failed ? "fail" : "default"}>
                  {formatLabel(format)}
                </Badge>
              </div>
              <p>{routine.desc}</p>
              <p className="faint" style={{ fontSize: "var(--fs-sm)" }}>
                {routine.steps.length} 步
                {state?.finalStage ? ` · 已到 ${state.finalStage}` : ""}
              </p>
              <label className="field" style={{ marginBottom: 8 }}>
                <span>题材 / 想法（可选）</span>
                <textarea
                  className="input"
                  rows={2}
                  value={ideas[format] || ""}
                  placeholder="例如：都市逆袭、先婚后爱、764 规则怪谈…"
                  onChange={(e) =>
                    setIdeas((prev) => ({ ...prev, [format]: e.target.value }))
                  }
                />
              </label>
              {state?.steps?.length ? (
                <div className="stack" style={{ gap: 3, marginBottom: 8 }}>
                  {state.steps.map((s, i) => (
                    <div key={i} className="row" style={{ gap: 5, alignItems: "center" }}>
                      {s.status === "done" ? (
                        <Check size={13} style={{ color: "var(--ok)" }} />
                      ) : s.status === "failed" ? (
                        <X size={13} style={{ color: "var(--warn)" }} />
                      ) : s.status === "running" ? (
                        <Loader2 size={13} className="spin" />
                      ) : (
                        <ChevronRight size={13} style={{ opacity: 0.4 }} />
                      )}
                      <span
                        className="faint"
                        style={{ fontSize: "var(--fs-xs)", flex: 1 }}
                        title={s.error}
                      >
                        {s.label}
                        {s.error ? ` · ${s.error.slice(0, 60)}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              <Button
                variant="primary"
                disabled={state?.busy}
                onClick={() => void runRoutine(format, routine)}
              >
                {state?.busy ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <Play size={14} />
                )}
                {state?.busy ? "执行中…" : state?.finished ? "重跑例程" : "运行例程"}
              </Button>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
