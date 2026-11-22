import { useRef, useState } from "react";
import { Button, Modal, toast } from "@xiezuomanju/ui";
import { api, type EditorialRevision, type RetryContext, type TaskGroup } from "../../api/client";

function selectedSource(text: string, start: number, end: number) {
  // Textareas normalize CRLF to LF. Keep the submitted selection in original source units.
  const sourceUnits = text.match(/\r\n|[\s\S]/g) || [];
  return sourceUnits.slice(start, end).join("");
}

export function canResumeBatch(group: TaskGroup) {
  if (group.status !== "partial_failed" || group.kind !== "multi_agent") return false;
  const runs = group.runs || [];
  if (runs.some(r => r.status === "failed" && !r.attempt && !r.jobId)) return true;
  const pending = runs.filter(r => r.status !== "succeeded");
  return runs.length > 1 && pending.length === 1 && ["qc.human_checklist", "qc.human_qc_duanju"].includes(pending[0].agentId)
    && pending[0].status === "cancelled" && !pending[0].jobId && !pending[0].attempt
    && pending[0].progressStage === "前序正文失败，已停止批次";
}

export function EditorialRetryDialog({jobId, onComplete}: {jobId: string; onComplete: () => void}) {
  const [context, setContext] = useState<Extract<RetryContext, {eligible: true}> | null>(null);
  const [quote, setQuote] = useState("");
  const [notes, setNotes] = useState("");
  const [operation, setOperation] = useState<EditorialRevision["operation"]>("shorten");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<{key: string; revisionId: string} | null>(null);

  async function open(refresh = false) {
    setPending(true);
    setError("");
    try {
      const next = await api.getRetryContext(jobId);
      if (next.eligible) {
        if (context?.sourceTextHash !== next.sourceTextHash || context.expectedLeaseVersion !== next.expectedLeaseVersion) {
          setQuote("");
          setNotes("");
          request.current = null;
        }
        setContext(next);
      } else if (next.requiresRevision || refresh) {
        setContext(null);
        throw new Error(next.reason || "任务状态已变化，请刷新任务。");
      } else {
        await api.retryJob(jobId);
        toast.ok("已重新入队");
        onComplete();
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      toast.fail(message);
    } finally {
      setPending(false);
    }
  }

  async function submit() {
    if (!context || !quote.trim() || !notes.trim() || pending) return;
    const revision = {expectedLeaseVersion: context.expectedLeaseVersion, sourceCallId: context.sourceCallId,
      sourceTextHash: context.sourceTextHash, selectedQuote: quote, operation, instructions: notes.trim()};
    const key = JSON.stringify(revision);
    if (request.current?.key !== key) request.current = {key, revisionId: crypto.randomUUID()};
    setPending(true);
    setError("");
    try {
      await api.retryJob(jobId, {...revision, revisionId: request.current.revisionId});
      setContext(null);
      toast.ok("已提交作者修订");
      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  return <>
    <Button size="sm" disabled={pending} onClick={() => void open()}>重试任务</Button>
    <Modal open={Boolean(context)} title="修订本集草稿" description="选中需要修改的原文，再写下给写手的意见。"
      onOpenChange={value => { if (!value && !pending) setContext(null); }}>
      {context && <>
        <label>最近草稿 · {context.count} 字 · 大纲第 {context.outline.version} 版
          <textarea readOnly rows={12} style={{width:"100%"}} value={context.sourceText} onSelect={event => {
            const input = event.currentTarget;
            setQuote(selectedSource(context.sourceText, input.selectionStart, input.selectionEnd));
          }} />
        </label>
        <p aria-live="polite">{quote ? `已选中 ${Array.from(quote).length} 字` : "尚未选中原文"}</p>
        <label>修改方式 <select disabled={pending} value={operation}
          onChange={e => setOperation(e.target.value === "shorten" ? "shorten" : "rewrite")}>
          <option value="shorten">精简</option><option value="rewrite">改写</option>
        </select></label>
        <label>作者意见<textarea rows={5} disabled={pending} style={{width:"100%"}} value={notes} onChange={e => setNotes(e.target.value)} /></label>
        {error && <p role="alert">{error} <Button disabled={pending} onClick={() => void open(true)}>刷新草稿</Button></p>}
        <Button variant="primary" loading={pending} disabled={pending || !quote.trim() || !notes.trim()} onClick={() => void submit()}>提交修订</Button>
      </>}
    </Modal>
  </>;
}
