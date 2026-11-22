import {useQuery} from "@tanstack/react-query";
import {api, type KnowledgeExecution} from "../../api/client";

export function KnowledgeScopeFields({value, onChange}: {
  value: KnowledgeExecution; onChange: (value: KnowledgeExecution) => void;
}) {
  const projects = useQuery({queryKey:["projects"],queryFn:()=>api.listProjects()});
  const docs = useQuery({queryKey:["knowledge-doc-options"],queryFn:api.documentOptions,enabled:!!value.enabled});
  const format = value.formats?.[0] || "manju";
  const stages = useQuery({queryKey:["stage-graph",format],queryFn:()=>api.getStageGraph(format),enabled:!!value.enabled});
  return <fieldset className="stack">
    <label><input type="checkbox" checked={!!value.enabled} onChange={e=>onChange(e.target.checked ? {enabled:true,formats:[format],documentIds:[]} : {})}/> 启用知识顾问</label>
    {value.enabled && <>
      <label>项目 <select value={value.projectId || ""} onChange={e=>{
        const project=projects.data?.find(p=>p.id===e.target.value);
        onChange({...value,projectId:project?.id,formats:[project?.format || format],stage:undefined});
      }}><option value="">本人的适用项目</option>{projects.data?.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
      <label>格式 <select disabled={!!value.projectId} value={format} onChange={e=>onChange({...value,formats:[e.target.value],stage:undefined})}>
        {["manju","duanju","short_novel","male_long","female_long","ip_adapt"].map(f=><option key={f}>{f}</option>)}
      </select></label>
      <label>阶段 <select value={value.stage || ""} onChange={e=>onChange({...value,stage:e.target.value || undefined})}>
        <option value="">全部阶段</option>{stages.data?.stages.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
      </select></label>
      <strong>授权知识文档</strong>{docs.data?.map(doc=><label key={doc.id}><input type="checkbox"
        checked={value.documentIds?.includes(doc.id) || false} onChange={e=>onChange({...value,documentIds:e.target.checked ?
          [...value.documentIds || [],doc.id] : value.documentIds?.filter(id=>id!==doc.id)})}/> {doc.title}</label>)}
    </>}
  </fieldset>;
}
