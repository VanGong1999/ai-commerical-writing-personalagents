import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DiffCompare, Modal, toast } from "@xiezuomanju/ui";
import { api, type DirectoryMount } from "../../api/client";
import { SelectionActions } from "../references/SelectionActions";

export function MountedFilesDialog({mount,onClose}:{mount:DirectoryMount;onClose:()=>void}) {
 const qc=useQueryClient();
 const [dir,setDir]=useState(`/files/${mount.name}`), [path,setPath]=useState<string|null>(null),[version,setVersion]=useState<string|null>(null),[busy,setBusy]=useState(false);
 const [range,setRange]=useState<{start:number;end:number}|null>(null);
 const entries=useQuery({queryKey:["mounted-files",dir],queryFn:()=>api.fsLs(dir)});
 const file=useQuery({queryKey:["mounted-text",path],queryFn:()=>api.fsRead(path!),enabled:!!path});
 const history=useQuery({queryKey:["mounted-versions",path],queryFn:()=>api.listFileVersions(path!),enabled:!!path});
 const previous=useQuery({queryKey:["mounted-version",path,version],queryFn:()=>api.getFileVersion(path!,version!),enabled:!!path&&!!version});
 const restore=async()=>{
  if(!path||!version||!file.data?.hash)return;
  setBusy(true);
  try {await api.restoreFileVersion(path,version,file.data.hash);setVersion(null);setRange(null);await qc.invalidateQueries({queryKey:["mounted-text",path]});await qc.invalidateQueries({queryKey:["mounted-versions",path]});toast.ok("已恢复内容，恢复前的版本也已保存");}
  catch(e){toast.fail(e instanceof Error?e.message:"恢复失败");}
  finally{setBusy(false);}
 };
 return <Modal open onOpenChange={value=>{if(!value)onClose();}} title={`目录 · ${mount.name}`} description={mount.readOnly?"只读目录，可选取片段交给助手分析":"可写目录，助手修改前核对内容版本，历史修改可在此比较和恢复"}>
  <div className="row"><small>{dir}</small><Button size="sm" variant="ghost" disabled={dir===`/files/${mount.name}`} onClick={()=>{setDir(dir.slice(0,dir.lastIndexOf("/")));setPath(null);setVersion(null);}}>上一级</Button></div>
  {entries.isError?<p role="alert">目录读取失败，请检查挂载和权限。</p>:entries.isLoading?<p>读取中…</p>:<div className="row" style={{flexWrap:"wrap"}}>{entries.data?.entries.map(e=><Button size="sm" variant="ghost" key={String(e.path)} onClick={()=>{setRange(null);setVersion(null);if(e.type==="dir"){setDir(String(e.path));setPath(null);}else setPath(String(e.path));}}>{e.type==="dir"?"文件夹":"文件"} · {String(e.name)}</Button>)}</div>}
  {path&&<><p>{path}</p>{file.isError?<p role="alert">文件不可读取或不属于支持的文本资料。</p>:<><textarea className="textarea" rows={10} readOnly value={file.data?.raw||""} aria-label="本机文件原文" onSelect={e=>setRange({start:e.currentTarget.selectionStart,end:e.currentTarget.selectionEnd})}/><SelectionActions source={{kind:"file",sourceId:path,title:path.split("/").pop()}} text={file.data?.raw||""} range={range}/></>}
   <p>历史版本</p>{history.data?.versions.length?history.data.versions.map(v=><Button key={v.id} size="sm" variant="ghost" onClick={()=>setVersion(v.id)}>{new Date(v.createdAt).toLocaleString("zh-CN")} · {v.hash.slice(0,8)}</Button>):<p className="muted">尚无助手保存的历史版本。</p>}
   {previous.data&&<><DiffCompare leftTitle="历史内容" rightTitle="当前内容" left={<pre style={{whiteSpace:"pre-wrap"}}>{previous.data.content}</pre>} right={<pre style={{whiteSpace:"pre-wrap"}}>{file.data?.raw}</pre>}/><Button disabled={mount.readOnly||busy} loading={busy} onClick={()=>void restore()}>恢复此版本</Button></>}
  </>}
 </Modal>;
}
