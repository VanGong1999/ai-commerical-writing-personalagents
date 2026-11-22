import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Modal, toast } from "@xiezuomanju/ui";
import { useEffect, useState } from "react";
import { api, type Bot, type BotCreateInput } from "../../api/client";

import {KnowledgeScopeFields} from "./KnowledgeScopeFields";

type Mode = "interview" | "form";

export function CreateBotDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (bot: Bot) => void;
}) {
  const [mode, setMode] = useState<Mode>("interview");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [freeText, setFreeText] = useState("");
  const [form, setForm] = useState<BotCreateInput>({
    name: "",
    persona: "",
    tone: "",
    duties: [],
    neverDo: [],
    trustLevel: 1,
  });
  const [dutiesText, setDutiesText] = useState("");
  const [neverText, setNeverText] = useState("");

  const questionsQ = useQuery({
    queryKey: ["bot-interview-questions"],
    queryFn: () => api.listInterviewQuestions(),
    enabled: open && mode === "interview",
  });

  useEffect(() => {
    if (!open) {
      setAnswers({});
      setFreeText("");
      setForm({ name: "", persona: "", tone: "", duties: [], neverDo: [], trustLevel: 1 });
      setDutiesText("");
      setNeverText("");
      setMode("interview");
    }
  }, [open]);

  const createFromForm = useMutation({
    mutationFn: () =>
      api.createBot({
        ...form,
        name: form.name.trim(),
        duties: dutiesText
          .split(/[,，\n]/)
          .map((s) => s.trim())
          .filter(Boolean),
        neverDo: neverText
          .split(/[,，\n]/)
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    onSuccess: (bot) => {
      toast.ok(`已创建同事「${bot.name}」`);
      onCreated?.(bot);
      onOpenChange(false);
    },
    onError: (e: Error) => toast.fail(e.message),
  });

  const createFromInterview = useMutation({
    mutationFn: async () => {
      const draftRes = await api.interviewBot("new", {
        answers: {
          ...answers,
          trust_level: answers.trust_level ? Number(answers.trust_level) : 1,
        },
        freeText: freeText || null,
      });
      const draft = draftRes.draft || {};
      const name =
        String(draft.name || answers.name || "").trim() ||
        String(answers.role || "新同事").trim();
      return api.createBot({
        name,
        persona: String(draft.persona || answers.role || ""),
        tone: String(draft.tone || answers.tone || ""),
        duties: Array.isArray(draft.duties)
          ? (draft.duties as string[])
          : String(answers.duties || "")
              .split(/[,，\n]/)
              .map((s) => s.trim())
              .filter(Boolean),
        neverDo: Array.isArray(draft.never_do)
          ? (draft.never_do as string[])
          : String(answers.never_do || "")
              .split(/[,，\n]/)
              .map((s) => s.trim())
              .filter(Boolean),
        trustLevel: Number(draft.trust_level ?? answers.trust_level ?? 1) || 1,
        roleKind: String(draft.role_kind || "specialist"),
      });
    },
    onSuccess: (bot) => {
      toast.ok(`已入职「${bot.name}」`);
      onCreated?.(bot);
      onOpenChange(false);
    },
    onError: (e: Error) => toast.fail(e.message),
  });

  const pending = createFromForm.isPending || createFromInterview.isPending;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="新建 AI 同事"
      description="可通过入职访谈或直接填写表单创建。"
      width={520}
      footer={
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <Button onClick={() => onOpenChange(false)} disabled={pending}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={pending}
            onClick={() => {
              if (mode === "interview") createFromInterview.mutate();
              else {
                if (!form.name.trim()) {
                  toast.fail("请填写名字");
                  return;
                }
                createFromForm.mutate();
              }
            }}
          >
            {pending ? "创建中…" : "创建"}
          </Button>
        </div>
      }
    >
      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <Button
          size="sm"
          variant={mode === "interview" ? "primary" : "ghost"}
          onClick={() => setMode("interview")}
        >
          入职访谈
        </Button>
        <Button
          size="sm"
          variant={mode === "form" ? "primary" : "ghost"}
          onClick={() => setMode("form")}
        >
          表单创建
        </Button>
      </div>

      {mode === "interview" ? (
        <div className="stack" style={{ gap: 10 }}>
          {(questionsQ.data?.questions || []).map((q) => (
            <label key={q.key} className="field">
              <span>{q.prompt}</span>
              <input
                className="input"
                type={q.type === "number" ? "number" : "text"}
                value={answers[q.key] ?? (q.default != null ? String(q.default) : "")}
                onChange={(e) => setAnswers((prev) => ({ ...prev, [q.key]: e.target.value }))}
              />
            </label>
          ))}
          <label className="field">
            <span>补充说明（可选）</span>
            <textarea
              className="input"
              rows={3}
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              placeholder="任何你想强调的工作习惯、禁忌…"
            />
          </label>
        </div>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          <KnowledgeScopeFields value={form.execution || {}} onChange={execution=>setForm(p=>({...p,execution}))}/>
          <label className="field">
            <span>名字</span>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>人设</span>
            <textarea
              className="input"
              rows={3}
              value={form.persona || ""}
              onChange={(e) => setForm((p) => ({ ...p, persona: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>语气</span>
            <input
              className="input"
              value={form.tone || ""}
              onChange={(e) => setForm((p) => ({ ...p, tone: e.target.value }))}
            />
          </label>
          <label className="field">
            <span>职责（逗号或换行分隔）</span>
            <textarea
              className="input"
              rows={2}
              value={dutiesText}
              onChange={(e) => setDutiesText(e.target.value)}
            />
          </label>
          <label className="field">
            <span>绝不做（逗号或换行分隔）</span>
            <textarea
              className="input"
              rows={2}
              value={neverText}
              onChange={(e) => setNeverText(e.target.value)}
            />
          </label>
          <label className="field">
            <span>信任等级 0–3</span>
            <input
              className="input"
              type="number"
              min={0}
              max={3}
              value={form.trustLevel ?? 1}
              onChange={(e) =>
                setForm((p) => ({ ...p, trustLevel: Number(e.target.value) || 0 }))
              }
            />
          </label>
        </div>
      )}
    </Modal>
  );
}
