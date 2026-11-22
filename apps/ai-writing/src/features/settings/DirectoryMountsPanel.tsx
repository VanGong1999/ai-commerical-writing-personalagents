import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Panel, toast } from "@xiezuomanju/ui";
import { MountedFilesDialog } from "./MountedFilesDialog";
import { api, type DirectoryMount } from "../../api/client";

export function DirectoryMountsPanel() {
  const qc=useQueryClient();
  const [browse,setBrowse]=useState<DirectoryMount|null>(null);
  const [name,setName]=useState(""), [root,setRoot]=useState(""), [readOnly,setReadOnly]=useState(true);
  const {data,isLoading,isError}=useQuery({queryKey:["directory-mounts"],queryFn:()=>api.listDirectoryMounts()});
  const save=useMutation({mutationFn:()=>api.saveDirectoryMount({name,root,readOnly}),onSuccess:()=>{setName("");setRoot("");void qc.invalidateQueries({queryKey:["directory-mounts"]});toast.ok("目录已连接，助手可通过 /files 路径访问");},onError:e=>toast.fail(e instanceof Error?e.message:"目录连接失败")});
  const remove=useMutation({mutationFn:(mountName:string)=>api.removeDirectoryMount(mountName),onSuccess:()=>void qc.invalidateQueries({queryKey:["directory-mounts"]}),onError:e=>toast.fail(e instanceof Error?e.message:"移除失败")});
  return <Panel title="助手可访问的本机目录">
    <p className="muted">仅连接你指定的文字资料目录。默认只读；开启写入后，助手按内容版本保存修改，可回退。隐藏文件和二进制文件不会作为写作资料读取。</p>
    {isLoading?<p>加载目录…</p>:isError?<p role="alert">目录服务不可用，请检查 API 服务。</p>:data?.mounts.length?<ul>{data.mounts.map(m=><li key={m.name} style={{marginBottom:8}}><strong>/files/{m.name}</strong> · {m.root} · {m.readOnly?"只读":"可写"} <Button size="sm" variant="ghost" onClick={()=>setBrowse(m)}>浏览与版本</Button> <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={()=>remove.mutate(m.name)}>断开连接</Button></li>)}</ul>:<p>尚未连接目录，项目和知识库资料仍可正常使用。</p>}
    <div className="field-grid"><label className="field"><span>目录别名（英文）</span><input className="input" value={name} onChange={e=>setName(e.target.value)} placeholder="writing-notes" /></label><label className="field"><span>本机目录绝对路径</span><input className="input" value={root} onChange={e=>setRoot(e.target.value)} placeholder="/Users/你的用户名/Documents/写作资料" /></label></div>
    <label style={{display:"block",margin:"10px 0"}}><input type="checkbox" checked={readOnly} onChange={e=>setReadOnly(e.target.checked)} /> 只读访问</label>
    {browse&&<MountedFilesDialog key={browse.name} mount={browse} onClose={()=>setBrowse(null)}/>}
    <Button loading={save.isPending} disabled={!name.trim()||!root.trim()} onClick={()=>save.mutate()}>连接目录</Button>
  </Panel>;
}
