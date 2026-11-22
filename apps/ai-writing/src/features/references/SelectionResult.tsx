import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, DiffCompare, Modal, toast } from "@xiezuomanju/ui";
import { api } from "../../api/client";
import { applySelectionEdit, type ContextRef } from "./selection";
import { draftTarget, textHash } from "./draftTargets";

export function SelectionResult({ refs, text }: { refs: ContextRef[]; text: string }) {
  const candidates = refs.filter(r => (r.kind === "artifact" || r.kind === "draft") && r.projectId && r.start !== undefined);
  const [open,setOpen] = useState(false), [pick,setPick] = useState(0), [busy,setBusy] = useState(false);
  const [next,setNext] = useState(text);
  const qc = useQueryClient();
  if (!candidates.length || !text.trim()) return null;
  const ref = candidates[pick] || candidates[0];
  const apply = async (insert: boolean) => {
    setBusy(true);
    try {
      const editor = draftTarget(ref.sourceId);
      if (editor) {
        await editor(ref,next,insert);
        toast.ok("已应用到原编辑区，检查后保存即可");
      } else {
        if (ref.kind === "draft") throw new Error("这是未保存的草稿，请回到原编辑区后采纳；也可先复制候选");
        const current = (await api.listArtifacts(ref.projectId!)).find(a => a.id === ref.sourceId);
        if (!current || current.version !== ref.version) throw new Error("来源版本已变化，请打开原稿比较后重新引用");
        const body = current.type === "scene" ? String(current.bodyJson?.script_body || "") : current.bodyMarkdown;
        if (await textHash(body) !== ref.contentHash) throw new Error("原稿内容已变化，请比较后重新引用");
        const replacement = insert ? `${ref.quote}\n${next}` : next;
        const updated = applySelectionEdit(ref.sourceId,body,ref,replacement);
        await api.updateArtifact(ref.projectId!,ref.sourceId,{
          expectedVersion:current.version,
          ...(current.type === "scene" ? {bodyJson:{...current.bodyJson,script_body:updated,wordCount:updated.replace(/\s/g,"").length}} : {bodyMarkdown:updated}),
        });
        await qc.invalidateQueries({queryKey:["artifacts",ref.projectId]});
        await qc.invalidateQueries({queryKey:["artifact-versions",ref.projectId,ref.sourceId]});
        toast.ok("已保存选区修改，可在版本历史回退");
      }
      setOpen(false);
    } catch(e) { toast.fail(e instanceof Error ? e.message : "采纳失败"); }
    finally { setBusy(false); }
  };
  return <>
    <Button size="sm" variant="ghost" onClick={() => {setNext(text);setOpen(true);}}>作为选区候选…</Button>
    <Modal open={open} onOpenChange={setOpen} title="比较并采纳选区候选" description="先把候选调整为需要的正文，再替换或插入。总结、分析无需采纳。">
      {candidates.length > 1 && <select className="input" value={pick} onChange={e => setPick(Number(e.target.value))}>{candidates.map((r,i)=><option key={i} value={i}>{r.title} · {r.start}–{r.end}</option>)}</select>}
      <DiffCompare leftTitle="原选区" rightTitle="候选正文" left={<pre style={{whiteSpace:"pre-wrap"}}>{ref.quote}</pre>} right={<pre style={{whiteSpace:"pre-wrap"}}>{next}</pre>} />
      <textarea className="textarea" rows={9} value={next} onChange={e => setNext(e.target.value)} aria-label="调整候选正文" />
      <div className="row" style={{marginTop:12}}><Button loading={busy} onClick={() => void apply(false)}>替换选区</Button><Button disabled={busy} variant="ghost" onClick={() => void apply(true)}>插入到选区后</Button><Button variant="ghost" onClick={() => void navigator.clipboard.writeText(next).then(()=>toast.ok("已复制"),()=>toast.fail("复制失败，请手动复制"))}>复制</Button></div>
    </Modal>
  </>;
}
