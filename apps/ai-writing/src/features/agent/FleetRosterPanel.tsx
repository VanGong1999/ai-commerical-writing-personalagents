import {useEffect,useState} from 'react';
import {Badge} from '@xiezuomanju/ui';
import {api,type FleetListItem} from '../../api/client';
import {useAgentDirectory} from '../agent-chat/useAgentDirectory';

const states:Record<string,string>={pending:'排队中',running:'执行中',done:'已完成',failed:'未完成'};

/** Keep the complete team visible, including members that finish before their peers. */
export function FleetRosterPanel({projectId}:{projectId?:string|null}) {
  const [fleets,setFleets]=useState<FleetListItem[]>([]);
  const [error,setError]=useState(false);
  const {resolve}=useAgentDirectory();
  useEffect(()=>{
    let active=true;
    setFleets([]);setError(false);
    if(!projectId) return;
    const refresh=async()=>{
      try {
        const result=await api.listFleets(projectId);
        if(active){setFleets(result.fleets);setError(false);}
      } catch {if(active)setError(true);}
    };
    void refresh();
    const timer=setInterval(()=>void refresh(),4000);
    return ()=>{active=false;clearInterval(timer);};
  },[projectId]);
  if(!projectId || (!fleets.length && !error)) return null;
  return <section aria-label="协作编组完整成员" className="wb-cards">
    {error && <small role="status">编组状态暂时无法刷新，保留上次结果。</small>}
    {fleets.slice(0,5).map((fleet,index)=>{
      const members=fleet.reports || [];
      const done=members.filter(member=>member.status==='done').length;
      return <details key={fleet.planId} className="wb-card" open={index===0}>
        <summary>协作编组 · {members.length} 人 · {fleet.mode==='ordered'?'串行依赖':'并行协作'} · 已完成 {done}/{members.length}</summary>
        <ul className="wb-cards">
          {members.map(member=><li key={member.runId || `${fleet.planId}:${member.index}`} className="wb-card">
            <div className="wb-card__head"><strong>{member.name}</strong>
              <Badge tone={member.status==='done'?'ok':member.status==='failed'?'fail':'default'}>{states[member.status] || member.status}</Badge>
            </div>
            {member.agentId && <small>{resolve(member.agentId).persona}</small>}
            {member.task && <p className="wb-card__text">{member.task}</p>}
          </li>)}
        </ul>
        {fleet.awaitingHumanMerge && <small>全部成员已提交，等待确认汇总。</small>}
      </details>;
    })}
  </section>;
}
