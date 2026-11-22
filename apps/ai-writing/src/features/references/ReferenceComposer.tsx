import { useEffect, useRef, useState } from "react";
import { Button, Modal, toast } from "@xiezuomanju/ui";
import { api } from "../../api/client";
import { selectionRequest, sameReference, type ContextRef } from "./selection";

type Source = { kind: ContextRef["kind"]; sourceId: string; title: string; projectId?: string; version?: number; isDirectory?:boolean };

export function ReferenceChips({ refs, onRemove }: { refs: ContextRef[]; onRemove?: (index: number) => void }) {
  return <div className="reference-chips">{refs.map((ref, i) => <details key={`${ref.id || ref.sourceId}:${ref.start}:${i}`} className="reference-chip">
    <summary>@{ref.title || ref.sourceId}{ref.start !== undefined ? ` · 片段 ${ref.start}–${ref.end}` : ""}{ref.kind === "draft" ? " · 草稿快照" : ref.version ? ` · v${ref.version}` : ""}</summary>
    <blockquote style={{ whiteSpace: "pre-wrap", maxHeight: 200, overflow: "auto", margin: "8px 0" }}>{ref.quote || "发送前按来源解析"}</blockquote>
    {ref.projectId && ref.sourceId && <a href={`/projects/${encodeURIComponent(ref.projectId)}`} target="_blank" rel="noreferrer">查看来源项目</a>}
    {ref.kind === "kb_doc" && <a href={`/kb/docs/${encodeURIComponent(ref.sourceId)}`} target="_blank" rel="noreferrer">查看原文</a>}
    {onRemove && <Button size="sm" variant="ghost" onClick={() => onRemove(i)}>移除引用</Button>}
  </details>)}</div>;
}

/** All assistant entry points share the same material selector and previews. */
export function ReferenceComposer({ refs, onChange, projectId }: { refs: ContextRef[]; onChange: (refs: ContextRef[]) => void; projectId?: string }) {
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);
  const [fileEntries,setFileEntries]=useState<Source[]>([]);
  const [filePath,setFilePath]=useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<Source | null>(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const request = useRef(0);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    void (async () => {
      try {
        const [docs, projects, mounts] = await Promise.all([api.listDocs(), projectId ? Promise.resolve([{id:projectId}]) : api.listProjects(),api.listDirectoryMounts()]);
        const lists = await Promise.all(projects.map(p => api.listArtifacts(p.id)));
        if (live) setSources([
          ...mounts.mounts.map(m=>({kind:"file" as const,sourceId:`/files/${m.name}`,title:`目录 · ${m.name}`,isDirectory:true})),
          ...docs.map(d => ({kind:"kb_doc" as const,sourceId:d.id,title:d.title})),
          ...lists.flat().map(a => ({kind:"artifact" as const,sourceId:a.id,title:a.title,projectId:a.projectId,version:a.version})),
        ]);
      } catch (e) { if (live) toast.fail(e instanceof Error ? e.message : "资料加载失败"); }
      finally { if (live) setLoading(false); }
    })();
    return () => { live = false; request.current++; };
  }, [open, projectId]);

  const preview = async (item: Source) => {
    const ticket = ++request.current;
    if (item.isDirectory) {
      setLoading(true);
      try {
        const out=await api.fsLs(item.sourceId);
        if(ticket===request.current) {setFilePath(item.sourceId);setFileEntries(out.entries.map(e=>({kind:"file",sourceId:String(e.path),title:String(e.name),isDirectory:e.type === "dir"})));setSource(null);setText("");}
      } catch(e) {toast.fail(e instanceof Error?e.message:"目录读取失败");}
      finally {if(ticket===request.current)setLoading(false);}
      return;
    }
    setSource(item); setText(""); setRange(null); setLoading(true);
    try {
      let body: string;
      if (item.kind === "file") body = (await api.fsRead(item.sourceId)).raw;
      else if (item.kind === "kb_doc") body = (await api.getDocText(item.sourceId)).text;
      else {
        const artifact = await api.getContextArtifactText(item.sourceId);
        body = artifact.text;
        item = {...item,version:artifact.version,projectId:artifact.projectId};
      }
      if (ticket === request.current) { setSource(item); setText(body); }
    } catch (e) { if (ticket === request.current) toast.fail(e instanceof Error ? e.message : "读取失败"); }
    finally { if (ticket === request.current) setLoading(false); }
  };
  const add = (whole: boolean) => {
    if (!source) return;
    try {
      const selected = selectionRequest(source, text, whole ? 0 : range?.start ?? 0, whole ? text.length : range?.end ?? 0);
      delete selected.draftText; // source is persisted; server validates the exact version and quote
      if (refs.length >= 8) throw new Error("每条消息最多引用 8 份资料");
      if (!refs.some(r => sameReference(r, selected))) onChange([...refs, selected]);
      setOpen(false);
    } catch (e) { toast.info(e instanceof Error ? e.message : "请选择一段文字"); }
  };
  return <div className="reference-composer">
    <ReferenceChips refs={refs} onRemove={i => onChange(refs.filter((_, n) => n !== i))} />
    <Button size="sm" variant="ghost" onClick={() => {setOpen(true);setSource(null);setText("");setFileEntries([]);setFilePath(null);}}>＋ @资料</Button>
    <Modal open={open} onOpenChange={setOpen} title="引用资料 · 可选中其中一段">
      <input className="input" placeholder="搜索小说、剧本或项目产物" value={query} onChange={e => setQuery(e.target.value)} />
      <div className="reference-picker-grid">
        <div style={{maxHeight:380,overflow:"auto"}}>{filePath && <div><small>{filePath}</small><Button size="sm" variant="ghost" onClick={()=>{if(filePath.split("/").length>3)void preview({kind:"file",sourceId:filePath.slice(0,filePath.lastIndexOf("/")),title:"上一级",isDirectory:true});else{setFilePath(null);setFileEntries([]);}}}>返回上一级</Button></div>}{(filePath ? fileEntries : sources).filter(s => s.title.toLowerCase().includes(query.toLowerCase())).map(s => <button key={`${s.kind}:${s.sourceId}`} type="button" onClick={() => void preview(s)} style={{display:"block",textAlign:"left",width:"100%",padding:8}}>{s.isDirectory ? "文件夹" : s.kind === "file" ? "文件" : s.kind === "kb_doc" ? "资料" : "稿件"} · {s.title}</button>)}{!sources.length && !loading && <p>暂无可引用资料，先上传作品或创建稿件。</p>}</div>
        <div><p>{loading ? "读取中…" : source?.title || "选择资料，然后选中需要处理的片段"}</p><textarea className="textarea" rows={12} readOnly value={text} aria-label="资料原文，选中一段后引用" onSelect={e => setRange({start:e.currentTarget.selectionStart,end:e.currentTarget.selectionEnd})} /><div className="row" style={{marginTop:8}}><Button disabled={loading || !range || range.start === range.end} onClick={() => add(false)}>引用选区</Button><Button variant="ghost" disabled={loading || !text || text.length > 4000} onClick={() => add(true)}>引用全文</Button></div>{text.length > 4000 && <p className="muted">长资料请选取片段，助手会按需读取更多背景。</p>}</div>
      </div>
    </Modal>
  </div>;
}
