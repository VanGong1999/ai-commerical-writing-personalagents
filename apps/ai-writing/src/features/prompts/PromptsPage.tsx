import { useMutation, useQuery } from "@tanstack/react-query";
import { checkPromptLock, type PromptTemplate } from "@xiezuomanju/domain";
import {
  agentLinks,
  packs,
  prompts as registryPrompts,
  skillLinks,
} from "@xiezuomanju/prompt-registry";
import {
  Badge,
  Button,
  GateBadgeList,
  HelpCallout,
  HelpIcon,
  HelpTip,
  Modal,
  PageHeader,
  Panel,
  toast,
} from "@xiezuomanju/ui";
import { Select } from "@xiezuomanju/ui";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { api, formatLabel } from "../../api/client";
import { runAgentFeedback } from "../studio/runAgentFeedback";

const FORMAT_FILTERS = [
  "all",
  "manju",
  "duanju",
  "short_novel",
  "male_long",
  "female_long",
  "ip_adapt",
] as const;

const STAGE_LABELS: Record<string, string> = {
  S0_SETUP: "第 0 步 · 项目设定",
  S0_MARKET: "第 0 步 · 市场设定",
  S1_HOOK_BATCH: "第 1 步 · 核心梗",
  S1_TOPIC: "第 1 步 · 短剧选题",
  S1_IP_EVAL: "第 1 步 · IP 选书",
  S2_HOOK_SELECT: "第 2 步 · 选梗",
  S2_CHARACTER: "第 2 步 · 人物设定",
  S2_SWAP: "第 2 步 · 换元设计",
  S2_UNIT_SPLIT: "第 2 步 · 单元拆解",
  S3_BIO: "第 3 步 · 人物设定",
  S3_BIO_ACK: "第 3 步 · 确认人物",
  S3_BEAT20: "第 3 步 · 二十节拍",
  S3_EMOTION: "第 3 步 · 情绪曲线",
  S3_VOLUME: "第 3 步 · 卷纲",
  S4_EP10_OUTLINE: "第 4 步 · 前十集大纲",
  S4_EP10_DRAFT: "第 4 步 · 短剧十集大纲",
  S4_OUTLINE_ACK: "第 4 步 · 确认大纲",
  S4_COMPRESS: "第 4 步 · 压缩重构",
  S4_VOLUME: "第 4 步 · 卷纲细化",
  S5_EP_BODY_BATCH: "第 5 步 · 分集正文",
  S5_SCENE: "第 5 步 · 场景与对白",
  S6_BODY_CHAPTER: "第 6 步 · 章节正文",
  S6_QA: "第 6 步 · 规格校正",
  S6_REVISE20: "第 6 步 · 修改 20 条",
  S7_STORYBOARD: "第 7 步 · 分镜",
  S7_SUBMIT: "第 7 步 · 投稿准备",
  S8_COOL_DENSITY: "第 8 步 · 爽点密度",
  S8_TABOO: "第 8 步 · 雷区检查",
  S8_EXTEND: "第 8 步 · 扩展大纲",
  S9_DE_AI: "第 9 步 · 去 AI 味",
  S10_HUMAN_QC: "第 10 步 · 人工校稿",
  S11_PITCH: "第 11 步 · 投稿打包",
  S11_EXTEND: "第 11 步 · 扩展大纲",
};

const stageLabel = (stage: string) =>
  STAGE_LABELS[stage] || stage.replace(/^S\d+_/, "步骤 ").replace(/_/g, " ");

const promptLabel = (name: string) =>
  name.replace(/\bBible\b/g, "设定资料").replace(/\bPrompt\b/g, "写作指令");

const variableTypeLabel = (type: string) =>
  type === "string" ? "文字" : type === "number" ? "数字" : type === "boolean" ? "是/否" : type;

function formatChip(f: string) {
  if (f === "all") return "全部";
  try {
    return formatLabel(f as Parameters<typeof formatLabel>[0]);
  } catch {
    return f;
  }
}

export function PromptsPage() {
  const [format, setFormat] = useState<(typeof FORMAT_FILTERS)[number]>("all");
  const [packId, setPackId] = useState<string>("all");
  const [q, setQ] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editable, setEditable] = useState("");
  const [tamper, setTamper] = useState(false);
  const [projectId, setProjectId] = useState("");

  // Skills 眼里的真相源：registry 全量；API 仅做锁定校验
  const prompts = registryPrompts;

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", "prompt-run"],
    queryFn: () => api.listProjects(),
  });

  const filtered = useMemo(() => {
    return prompts.filter((p) => {
      if (format !== "all" && !p.format.includes(format)) return false;
      if (packId !== "all") {
        const pack = packs.find((x) => x.id === packId);
        if (!pack?.templateIds.includes(p.id)) return false;
      }
      if (!q.trim()) return true;
      const blob = [
        p.id,
        p.name,
        p.stage,
        p.editableInstruction,
        p.lockedSystem,
        ...(p.gates || []),
        ...(p.requiredPhrases || []),
        skillLinks[p.id] || "",
      ]
        .join(" ")
        .toLowerCase();
      return blob.includes(q.trim().toLowerCase());
    });
  }, [prompts, format, packId, q]);

  const active: PromptTemplate | undefined = prompts.find((p) => p.id === activeId);

  useEffect(() => {
    if (active) {
      try {
        const saved = localStorage.getItem(`prompt-edit:${active.id}`);
        setEditable(saved ?? active.editableInstruction);
      } catch {
        setEditable(active.editableInstruction);
      }
      setTamper(false);
    }
  }, [active?.id]);

  const locked =
    tamper && active
      ? `${active.lockedSystem}\n# tampered`
      : (active?.lockedSystem ?? "");
  const gates = active
    ? checkPromptLock(editable, active.requiredPhrases, active.lockedHash, locked)
    : [];

  const validateMut = useMutation({
    mutationFn: () =>
      api.validatePrompt({
        lockedSystem: locked,
        lockedHash: active!.lockedHash,
        editableInstruction: editable,
        requiredPhrases: active!.requiredPhrases,
      }),
    onSuccess: (checks) => {
      const fail = checks.some((c) => c.result === "fail");
      if (fail) toast.fail("校验未通过：锁定区或必含词有问题");
      else toast.ok("校验通过，可开跑");
    },
    onError: (e) => toast.fail(e instanceof Error ? e.message : "校验失败"),
  });

  const regressionMut = useMutation({
    mutationFn: async () => {
      const suites = await api.listEvalSuites({ tier: "regression" });
      const fmt = active?.format?.[0];
      const suite =
        suites.suites.find((s) => fmt && s.format === fmt) ||
        suites.suites.find((s) => s.format === "*") ||
        suites.suites[0];
      if (!suite) throw new Error("没有可用的回归评测集，请先到质量评测同步种子");
      return api.createEvalRun({
        suiteId: suite.id,
        includeLlm: false,
        async: false,
        variant: {
          promptId: active?.id,
          editableInstruction: editable,
          systemPromptAppend: editable,
        },
      });
    },
    onSuccess: (run) => {
      const verdict = run.gateVerdict || "—";
      if (verdict === "blocked") {
        toast.fail(`回归门禁阻断：通过率 ${(run.metrics as { passRate?: number })?.passRate ?? "—"}`);
      } else {
        toast.ok(`回归门禁通过（${verdict}）· run ${run.id.slice(0, 8)}`);
      }
    },
    onError: (e) => toast.fail(e instanceof Error ? e.message : "回归评测失败"),
  });

  const runMut = useMutation({
    mutationFn: async () => {
      if (!active) throw new Error("未选中模板");
      const agentId = agentLinks[active.id];
      if (!agentId) throw new Error("这条写作指令还没有绑定 AI 助手");
      if (!projectId) throw new Error("请先选择项目");
      const checks = await api.validatePrompt({
        lockedSystem: locked,
        lockedHash: active.lockedHash,
        editableInstruction: editable,
        requiredPhrases: active.requiredPhrases,
      });
      if (checks.some((c) => c.result === "fail")) {
        throw new Error("锁定校验未通过，禁止开跑");
      }
      return runAgentFeedback(projectId, agentId, {
        quiet: true,
        label: promptLabel(active.name) || agentId,
        inputJson: {
          promptId: active.id,
          editableInstruction: editable,
        },
      });
    },
    onSuccess: (run) => {
      toast.ok(`已开跑 · ${run.runId?.slice(0, 8) ?? run.status}`);
    },
    onError: (e) => toast.fail(e instanceof Error ? e.message : "开跑失败"),
  });

  const skillPath = active ? skillLinks[active.id] : undefined;
  const agentId = active ? agentLinks[active.id] : undefined;
  const belongingPacks = active
    ? packs.filter((p) => p.templateIds.includes(active.id))
    : [];
  const lockFailed = gates.some((g) => g.result === "fail");

  return (
    <div className="page page--wide prompts-page">
      <PageHeader
        title="写作指令"
        description={`共 ${prompts.length} 条指令 · ${packs.length} 个格式分组。固定规则不要改；可按题材微调的部分可以改。`}
      />

      <HelpCallout title="写作指令和助手方法有什么区别" tone="tip" collapsible defaultOpen={false}>
        写作指令是「这次具体怎么写」；助手方法是「这个 AI 助手长期怎么工作」。
        日常写作在创作台即可；这里用来查看固定规则、可替换内容和可调整的写作要求。
        <HelpIcon text="固定规则被改动时，系统会阻止开始写作。要调整风格，请只改「可调整的写作要求」。" />
      </HelpCallout>

      <div className="prompt-browser">
        <Panel
          className="prompt-groups panel--fill"
          title={
            <span>
              按格式分组
              <HelpIcon text="新建项目时会按题材自动选用一组写作指令。" />
            </span>
          }
        >
          <div className="prompt-groups__scroll stack">
            <button
              type="button"
              className="binder-item"
              data-active={packId === "all"}
              onClick={() => setPackId("all")}
            >
              <span style={{ flex: 1, textAlign: "left" }}>
                <div>全部模板</div>
                <div className="faint" style={{ fontSize: "var(--fs-xs)" }}>
                  {prompts.length} 条
                </div>
              </span>
            </button>
            {packs.map((pack) => (
              <HelpTip key={pack.id} label={pack.description || pack.name} side="right">
                <button
                  type="button"
                  className="binder-item"
                  data-active={packId === pack.id}
                  onClick={() => {
                    setPackId(pack.id);
                    setFormat(pack.format as (typeof FORMAT_FILTERS)[number]);
                  }}
                >
                  <span style={{ flex: 1, textAlign: "left" }}>
                    <div>{pack.name}</div>
                    <div className="faint" style={{ fontSize: "var(--fs-xs)" }}>
                      {formatChip(pack.format)} · {pack.templateIds.length} 条
                    </div>
                  </span>
                </button>
              </HelpTip>
            ))}
            <div className="prompt-groups__hint">
              <strong>怎么选</strong>
              <span>先选题材包缩小范围，再按写作阶段打开对应指令。固定规则由系统校验，只需调整可变要求。</span>
            </div>
          </div>
        </Panel>

        <div className="stack" style={{ gap: 12 }}>
          <Panel
            className="prompt-list-panel panel--fill"
            title={
              <span>
                指令列表
                <HelpIcon text="点卡片查看固定规则、可调整内容和检查项。" />
              </span>
            }
            actions={
              <input
                className="input"
                style={{ width: 220 }}
                placeholder="搜索名称 / 写作阶段 / 检查项…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            }
          >
            <div className="prompt-list__filters row">
              {FORMAT_FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  className="btn btn-ghost"
                  data-active={format === f}
                  onClick={() => {
                    setFormat(f);
                    if (f !== "all") setPackId("all");
                  }}
                  style={{
                    borderColor: format === f ? "var(--accent)" : undefined,
                    color: format === f ? "var(--accent-ink)" : undefined,
                  }}
                >
                  {formatChip(f)}
                </button>
              ))}
            </div>

            <div className="prompt-list__scroll">
              <div className="grid grid-2">
                {filtered.map((p) => (
                  <HelpTip key={p.id} label={`${stageLabel(p.stage)} · 点开查看全文`}>
                    <button
                      type="button"
                      className="skill-card"
                      data-active={active?.id === p.id}
                      onClick={() => {
                        setActiveId(p.id);
                        setTamper(false);
                      }}
                      style={{
                        textAlign: "left",
                        cursor: "pointer",
                        borderColor: active?.id === p.id ? "var(--brand-300)" : undefined,
                      }}
                    >
                      <div className="skill-card__head">
                        <div className="skill-card__name">{promptLabel(p.name)}</div>
                        <Badge>{p.format.map(formatChip).join("·")}</Badge>
                      </div>
                      <div className="skill-card__desc">
                        {stageLabel(p.stage)}
                        {skillLinks[p.id] ? " · 已绑定助手方法" : ""}
                      </div>
                      <div className="skill-card__meta">
                        {(p.gates || []).length > 0 && (
                          <Badge tone="warn">
                            检查 {(p.gates || []).length} 项
                          </Badge>
                        )}
                        <Badge>v{p.version}</Badge>
                      </div>
                    </button>
                  </HelpTip>
                ))}
              </div>
              {!filtered.length && <div className="empty">没有找到对应的写作指令。</div>}
            </div>
          </Panel>
        </div>
      </div>

      <Modal
        open={!!active}
        onOpenChange={(open) => {
          if (!open) setActiveId(null);
        }}
        className="prompt-modal"
        bodyClassName="prompt-modal__body"
        title={active ? promptLabel(active.name) : "写作指令"}
        description={active ? `${stageLabel(active.stage)} · 点开查看固定规则与可调整要求` : undefined}
        footer={
          active ? (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  setEditable(active.editableInstruction);
                  try {
                    localStorage.setItem(`prompt-edit:${active.id}`, active.editableInstruction);
                  } catch {
                    /* ignore */
                  }
                  toast.ok("已恢复默认可变指令");
                }}
              >
                恢复默认
              </Button>
              <label className="row prompt-modal__tamper">
                <input
                  type="checkbox"
                  checked={tamper}
                  onChange={(e) => setTamper(e.target.checked)}
                />
                测试固定规则被改动
              </label>
              <Select
                className="input prompt-modal__project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                title="开跑目标项目"
              >
                <option value="">选择项目…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title || p.id.slice(0, 8)}
                  </option>
                ))}
              </Select>
              <Button
                disabled={lockFailed || validateMut.isPending}
                onClick={() => validateMut.mutate()}
              >
                检查固定规则
              </Button>
              <Button
                disabled={regressionMut.isPending}
                onClick={() => regressionMut.mutate()}
              >
                {regressionMut.isPending ? "回归评测中…" : "跑回归评测门禁"}
              </Button>
              <Button
                variant="primary"
                disabled={
                  lockFailed ||
                  !agentId ||
                  !projectId ||
                  runMut.isPending ||
                  validateMut.isPending
                }
                onClick={() => runMut.mutate()}
              >
                {runMut.isPending ? "写作中…" : "检查并开始写作"}
              </Button>
            </>
          ) : null
        }
      >
        {active ? (
          <div className="prompt-modal__scroll stack">
            <GateBadgeList checks={gates} />

            <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
              {active.format.map((f) => (
                <Badge key={f}>{formatChip(f)}</Badge>
              ))}
              <Badge>{stageLabel(active.stage)}</Badge>
              <Badge>v{active.version}</Badge>
              {belongingPacks.map((pk) => (
                <Badge key={pk.id} tone="ok">
                  包 {pk.name}
                </Badge>
              ))}
              {(active.gates || []).map((g) => (
                <HelpTip key={g} label="写作完成后会自动检查，不通过就不算完成">
                  <Badge tone="warn">检查 {g}</Badge>
                </HelpTip>
              ))}
              {(active.requiredPhrases || []).map((ph) => (
                <HelpTip key={ph} label="可变指令里必须出现的关键词">
                  <Badge tone="fail">必含 {ph}</Badge>
                </HelpTip>
              ))}
            </div>

            <div className="faint prompt-modal__source">
              {agentId ? "已绑定 AI 助手" : "未绑定 AI 助手"}
              {active.outputSchema ? ` · 输出格式：${active.outputSchema}` : ""}
              {skillPath ? (
                <>
                  {" · "}
                  <Link
                    to="/skills"
                    search={{ skill: skillPath } as { skill?: string }}
                    style={{ color: "var(--accent-ink)" }}
                  >
                    查看助手方法
                  </Link>
                </>
              ) : null}
              <HelpIcon text={`内部编号：${active.id}；助手：${agentId || "无"}；方法位置：${skillPath || "无"}`} />
            </div>

            {!!(active.variables || []).filter((v) => v.key !== "_skillPath").length && (
              <div className="stack" style={{ gap: 6 }}>
                <span className="muted">可替换内容</span>
                <div className="prompt-modal__table">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>变量</th>
                        <th>类型</th>
                        <th>必填</th>
                        <th>选项/默认</th>
                      </tr>
                    </thead>
                    <tbody>
                      {active.variables
                        .filter((v) => v.key !== "_skillPath")
                        .map((v) => (
                          <tr key={v.key}>
                            <td>
                              {v.label}
                              <div className="faint" style={{ fontSize: "var(--fs-xs)" }}>
                                {v.key}
                              </div>
                            </td>
                            <td>{variableTypeLabel(v.type)}</td>
                            <td>{v.required ? "是" : "否"}</td>
                            <td className="muted">
                              {(v.options || []).join(" / ") ||
                                (v.defaultValue != null ? String(v.defaultValue) : "—")}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {!!(active.exampleSlots || []).length && (
              <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                <span className="muted">示例选项：</span>
                {active.exampleSlots!.map((s) => (
                  <Badge key={s}>{s}</Badge>
                ))}
              </div>
            )}

            <label className="stack">
              <span className="muted">
                固定规则（只读）
                <HelpIcon text={`这段内容不能修改，用于保证检查规则一致。内部校验码：${active.lockedHash}`} />
              </span>
              <textarea className="textarea skill-detail" rows={9} value={locked} readOnly />
            </label>

            <label className="stack">
              <span className="muted">
                可调整的写作要求
                <HelpIcon text="建议写清：题材要求、注意事项、想达到的目的、输出格式。" />
              </span>
              <textarea
                className="textarea skill-detail"
                rows={11}
                value={editable}
                onChange={(e) => {
                  const value = e.target.value;
                  setEditable(value);
                  try {
                    localStorage.setItem(`prompt-edit:${active.id}`, value);
                  } catch {
                    /* ignore */
                  }
                }}
              />
            </label>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
