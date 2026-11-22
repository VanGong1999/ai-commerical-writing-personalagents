import { Button, toast } from "@xiezuomanju/ui";
import { ThumbsDown, ThumbsUp, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../api/client";

type Tag = { code: string; label: string };

// 兜底标签（接口不可用时仍可标注）
const FALLBACK_TAGS: Tag[] = [
  { code: "W07", label: "AI 味/套路比喻" },
  { code: "W08", label: "钩子弱" },
  { code: "W06", label: "小说化/镜头感差" },
  { code: "W10", label: "爽点节奏缺失" },
  { code: "GOOD_HOOK", label: "钩子强" },
  { code: "GOOD_COOL", label: "爽点到位" },
];

/**
 * 段落/桥段级 👍/👎 反馈。选中文字后出现在视图底部，
 * 提交到 POST /eval/feedback，并作为好坏例供后续运行注入。
 */
export function SpanFeedbackBar({
  text,
  artifactId,
  projectId,
  format,
  artifactVersion,
  onDone,
}: {
  text: string;
  artifactId?: string;
  projectId?: string;
  format?: string;
  artifactVersion?: number;
  onDone: () => void;
}) {
  const [tags, setTags] = useState<Tag[]>(FALLBACK_TAGS);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .listFeedbackTags()
      .then((r) => setTags(r.tags))
      .catch(() => setTags(FALLBACK_TAGS));
  }, []);

  const submit = async (polarity: "good" | "bad") => {
    if (!artifactId) {
      toast.fail("缺少产物 ID，无法记录反馈");
      return;
    }
    setBusy(true);
    try {
      await api.postArtifactFeedback({
        artifactId,
        spanText: text,
        polarity,
        reasonTags: picked,
        projectId,
        format,
        artifactType: "manuscript",
        artifactVersion,
      });
      toast.ok(polarity === "good" ? "已记为好例" : "已记为坏例");
      onDone();
    } catch (e) {
      toast.fail(e instanceof Error ? e.message : "反馈提交失败");
    } finally {
      setBusy(false);
    }
  };

  const toggle = (code: string) =>
    setPicked((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));

  return (
    <div
      className="stack"
      style={{
        gap: 6,
        border: "1px solid var(--accent)",
        borderRadius: 8,
        padding: "8px 10px",
        background: "var(--bg-elevated, #fff)",
      }}
    >
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <span className="muted" style={{ fontSize: 12 }}>
          已选 {text.length} 字：&ldquo;{text.slice(0, 40)}
          {text.length > 40 ? "…" : ""}&rdquo;
        </span>
        <button type="button" className="badge" onClick={onDone} aria-label="关闭">
          <X size={12} />
        </button>
      </div>
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
        {tags.map((t) => (
          <button
            key={t.code}
            type="button"
            className="badge"
            onClick={() => toggle(t.code)}
            style={{
              cursor: "pointer",
              borderColor: picked.includes(t.code) ? "var(--accent)" : undefined,
              fontSize: 11,
            }}
          >
            {t.code} {t.label}
          </button>
        ))}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <Button size="sm" disabled={busy} onClick={() => void submit("good")}>
          <ThumbsUp size={13} />
          好例
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void submit("bad")}>
          <ThumbsDown size={13} />
          坏例
        </Button>
      </div>
    </div>
  );
}
