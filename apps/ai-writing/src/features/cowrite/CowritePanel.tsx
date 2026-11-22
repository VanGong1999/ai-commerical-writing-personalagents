import { useMutation } from "@tanstack/react-query";
import { Badge, Button, DiffCompare, Panel, toast } from "@xiezuomanju/ui";
import { Check, Copy, Loader2, PenLine } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client";

const MODES = [
  { id: "continue" as const, label: "续写", hint: "顺着文末接着写" },
  { id: "polish" as const, label: "润色优化", hint: "提升语言不改原意" },
  { id: "deai" as const, label: "去 AI 味", hint: "按 V3.8 清除套话" },
  { id: "expand" as const, label: "扩写", hint: "增加细节不注水" },
];

export function CowritePanel({
  projectId,
  initialText = "",
  compact = false,
  onReplace,
}: {
  projectId?: string;
  initialText?: string;
  compact?: boolean;
  onReplace?: (text: string) => void;
}) {
  const [text, setText] = useState(initialText);
  const [instruction, setInstruction] = useState("");
  const [mode, setMode] = useState<(typeof MODES)[number]["id"]>("polish");
  const [result, setResult] = useState("");

  const run = useMutation({
    mutationFn: () =>
      api.cowrite({ text, mode, instruction: instruction || undefined, projectId }),
    onSuccess: (r) => {
      if (r.hint) toast.warn(r.hint);
      else setResult(r.result);
    },
    onError: (e: Error) => toast.fail(e.message),
  });

  const replace = () => {
    setText(result);
    setResult("");
    onReplace?.(result);
    toast.ok("已替换，可继续迭代");
  };

  const DIRECTIONAL = [
    { label: "按卡点改", instruction: "把这段改成一个结尾卡点：悬念/危机/爽点爆点，留「然后呢」。" },
    { label: "按爽点改", instruction: "把这段按爽点逻辑改：先抑后扬、有对比、兑现超预期。" },
    { label: "按20拍改", instruction: "对照查理20节拍，只强化这一段对应的节拍功能，不写新剧情。" },
    { label: "去套路话", instruction: "删除总结性AI词汇、排比、华丽比喻，改短句口语。" },
  ];

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className="btn"
            data-active={mode === m.id}
            title={m.hint}
            style={{
              borderColor: mode === m.id ? "var(--accent)" : undefined,
              color: mode === m.id ? "var(--accent-ink)" : undefined,
            }}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
        {DIRECTIONAL.map((d) => (
          <button
            key={d.label}
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setInstruction((prev) => (prev ? `${prev}；${d.instruction}` : d.instruction))}
          >
            {d.label}
          </button>
        ))}
      </div>
      <textarea
        className="textarea"
        rows={compact ? 8 : 12}
        placeholder="粘贴或写一段正文，选模式后点开始。"
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{ minHeight: compact ? 160 : 240, fontFamily: "var(--font-display)", lineHeight: 1.7 }}
      />
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <input
          className="input"
          style={{ flex: 1, minWidth: 160 }}
          placeholder="额外要求（可选）"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
        />
        <Badge>{text.trim().length.toLocaleString()} 字</Badge>
        <Button variant="primary" disabled={!text.trim() || run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? <Loader2 size={15} className="assistant__spinner" /> : <PenLine size={15} />}
          {run.isPending ? "生成中…" : "开始"}
        </Button>
      </div>
      {result && (
        <Panel
          title="AI 结果 · 对照"
          actions={
            <div className="row" style={{ gap: 6 }}>
              <Button size="sm" variant="primary" onClick={replace}>
                <Check size={14} />
                采纳替换
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(result);
                  toast.ok("已复制");
                }}
              >
                <Copy size={14} />
                复制
              </Button>
            </div>
          }
        >
          <DiffCompare
            leftTitle="原文"
            rightTitle="AI 版"
            left={<pre className="prose-block">{text}</pre>}
            right={<pre className="prose-block">{result}</pre>}
          />
        </Panel>
      )}
    </div>
  );
}
