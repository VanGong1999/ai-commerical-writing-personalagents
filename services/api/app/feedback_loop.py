"""Versioned user feedback; observations never fabricate commercial outcomes."""
from collections import Counter, defaultdict
from sqlalchemy import select
from sqlmodel import Session
from .models import ActivityLog, AppSetting, Artifact, ArtifactFeedback, Project
from .settings import get_settings

REASONS = {'W06':'增加可拍动作和画面，减少解释性心理描写','W08':'强化由人物行动产生的悬念','W15':'区分角色声口','W11':'改善情节因果与节奏','GOOD_HOOK':'保留有效的冲突和悬念','GOOD_VOICE':'保留角色独特声口'}

REASON_LABELS = {'动作画面不足':'W06','画面感不足':'W06','悬念不足':'W08','钩子太弱':'W08','角色声口相似':'W15','台词千人一面':'W15','人物说话都一样':'W15','因果关系不清':'W11','因果或节奏问题':'W11','对白太长':'short_dialogue','台词太长':'short_dialogue'}
REASONS['short_dialogue']='对白更简练，避免冗长解释'

def reason_key(value):
    # Only exact explicit labels; do not infer style from an entire conversation.
    return REASON_LABELS.get(str(value or '').strip(' 。！!'),value)

def profile_key():
    return 'personalization:' + get_settings().demo_user_id

def profile(session):
    row=session.get(AppSetting,profile_key())
    raw=(row.value_json if row else {}) or {}
    value=raw if isinstance(raw,dict) else {}
    preferences=value.get('preferences',[])
    preferences=preferences if isinstance(preferences,list) else []
    safe=[{'text':p['text'].strip()[:180],'format':p.get('format','*')} for p in preferences if isinstance(p,dict) and isinstance(p.get('text'),str) and p['text'].strip() and p.get('format','*') in ('*','manju','duanju','short_novel','male_long','female_long','ip_adapt')][:8]
    return {'enabled':value.get('enabled') if isinstance(value.get('enabled'),bool) else True, 'preferences':safe, 'resetAt':value.get('resetAt') if isinstance(value.get('resetAt'),str) else None}

def suggestions(session, project):
    cfg=profile(session)
    evidence=defaultdict(set)
    # Explicit paragraph feedback, only projects owned by this user and same format.
    ids=list(session.scalars(select(Project.id).where(Project.user_id==project.user_id, Project.format==project.format,Project.status!='eval_sandbox')))
    rows=list(session.scalars(select(ArtifactFeedback).where(ArtifactFeedback.project_id.in_(ids),ArtifactFeedback.actor=='user').order_by(ArtifactFeedback.created_at.desc()).limit(500)))
    for row in rows:
        if cfg.get('resetAt') and row.created_at.isoformat() <= cfg['resetAt']:
            continue
        if not row.artifact_id or row.artifact_version is None:
            continue
        for tag in set(row.reason_tags or []):
            if tag in REASONS and ((row.polarity=='bad' and tag.startswith('W')) or (row.polarity=='good' and tag.startswith('GOOD'))):
                evidence[tag].add((row.project_id,row.artifact_id,row.artifact_version))
    events=list(session.scalars(select(ActivityLog).where(ActivityLog.project_id.in_(ids),ActivityLog.action=='quality_feedback',ActivityLog.actor=='user').order_by(ActivityLog.created_at.desc()).limit(500)))
    for event in events:
        if cfg.get('resetAt') and event.created_at.isoformat() <= cfg['resetAt']:
            continue
        d=event.detail or {};tag=reason_key(d.get('reason'))
        if tag in REASONS and d.get('decision') in ('revise','discard') and (tag.startswith('W') or tag=='short_dialogue'):
            if d.get('artifactId') and isinstance(d.get('artifactVersion'), int):
                evidence[tag].add((event.project_id,d['artifactId'],d['artifactVersion']))
    counts=Counter({tag:len(sources) for tag,sources in evidence.items()})
    return [{'text':REASONS[tag],'evidenceCount':n,'sources':[{'projectId':pid,'artifactId':aid,'artifactVersion':version} for pid,aid,version in sorted(evidence[tag])[:5]],'confidence':round(min(.9,.5+n*.05),2),'source':'explicit_feedback','confidenceMeaning':'heuristic evidence strength; not a calibrated probability','format':project.format} for tag,n in counts.most_common(5) if n>=3]

def context(session, project):
    cfg=profile(session)
    if not cfg['enabled']:return ''
    lines=[p['text'] for p in cfg['preferences'] if p.get('format','*') in ('*',getattr(project,'format',None))]
    if not lines:return ''
    result='用户偏好（可撤销软建议；本次指令、项目事实和版本约束优先）：'
    for line in dict.fromkeys(lines):
        entry='\n- '+line
        if len(result)+len(entry)>1000:break
        result+=entry
    return result

def overview(session, project):
    events=list(session.scalars(select(ActivityLog).where(ActivityLog.project_id==project.id,ActivityLog.action=='quality_feedback').order_by(ActivityLog.created_at.desc()).limit(100)))
    audit=list(session.scalars(select(ActivityLog).where(ActivityLog.project_id==project.id,ActivityLog.actor=='user').order_by(ActivityLog.created_at.desc()).limit(500)))
    arts=list(session.scalars(select(Artifact).where(Artifact.project_id==project.id)))
    return {'projectId':project.id,'events':[{'id':r.id,**r.detail,'source':'declared','createdAt':r.created_at.isoformat()} for r in events],
        'observed':{'userEditCount':sum(r.action=='artifact_edit' for r in audit),'adoptedCount':sum(a.status=='adopted' for a in arts),'rollbackCount':sum(r.action=='rollback' for r in audit),'revisionChars':None,'measurement':'observed; includes tool saves; not human time or commercial outcome'},
        'personalization':{**profile(session),'suggestions':suggestions(session,project),'context':context(session,project)}}


def conversation_context(session, project_id):
    if project_id is None:
        return context(session,None)
    project=session.get(Project,project_id)
    if not project or project.user_id!=get_settings().demo_user_id:return ''
    return context(session,project)
