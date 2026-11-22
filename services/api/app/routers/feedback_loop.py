from typing import Literal
import hashlib
from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field, ConfigDict
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session
from ..db import get_session
from ..models import ActivityLog, AppSetting, Artifact, ArtifactVersion, Project, EvalCaseCandidate, utcnow
from ..schemas import APIModel
from ..settings import get_settings
from .. import feedback_loop as learning

router=APIRouter(tags=['feedback-loop'])
class FeedbackIn(APIModel):
    model_config=ConfigDict(alias_generator=lambda s: s.split('_')[0]+''.join(x.title() for x in s.split('_')[1:]),populate_by_name=True,allow_inf_nan=False,extra='forbid')
    artifact_id:str|None=None
    artifact_version:int|None=Field(None,ge=1)
    decision:Literal['adopt','revise','discard']|None=None
    outcome:Literal['unknown','draft','submitted','accepted','rejected','published']='unknown'
    reason:str=Field('',max_length=200)
    note:str=Field('',max_length=2000)
    manual_minutes:float|None=Field(None,ge=0,le=1000000)
    revenue:float|None=Field(None,ge=0,le=1e12)
    idempotency_key:str|None=Field(None,max_length=100)
class PreferenceIn(APIModel):
    text:str=Field(min_length=1,max_length=180)
    format:Literal['*','manju','duanju','short_novel','male_long','female_long','ip_adapt']='*'
class ProfileIn(APIModel):
    enabled:bool|None=None
    preferences:list[PreferenceIn]|None=Field(None,max_length=8)
def must_project(session,pid):
    p=session.get(Project,pid)
    if not p or p.user_id!=get_settings().demo_user_id:raise HTTPException(404,'project not found')
    return p
@router.get('/projects/{project_id}/feedback-loop')
def get_loop(project_id:str,session:Session=Depends(get_session)):
    return learning.overview(session,must_project(session,project_id))
@router.post('/projects/{project_id}/feedback-loop')
def post_feedback(project_id:str,body:FeedbackIn,session:Session=Depends(get_session)):
    p=must_project(session,project_id)
    if body.artifact_id:
        a=session.get(Artifact,body.artifact_id)
        if not a or a.project_id!=p.id:raise HTTPException(404,'artifact not found')
        if body.artifact_version is not None and body.artifact_version!=a.version:
            from sqlmodel import select
            if not session.exec(select(ArtifactVersion).where(ArtifactVersion.artifact_id==a.id,ArtifactVersion.version==body.artifact_version)).first():raise HTTPException(409,'artifact version not found')
        body.artifact_version=body.artifact_version or a.version
    elif body.artifact_version is not None:raise HTTPException(422,'artifactId required for artifactVersion')
    if body.decision is None and body.outcome=='unknown' and not body.reason.strip() and not body.note.strip() and body.manual_minutes is None and body.revenue is None:raise HTTPException(422,'feedback is empty')
    d=body.model_dump(by_alias=True,exclude={'idempotency_key'})
    rid='feedback:'+hashlib.sha256((p.id+':'+body.idempotency_key).encode()).hexdigest() if body.idempotency_key else None
    if rid:
        old=session.get(ActivityLog,rid)
        if old:
            if old.detail!=d:raise HTTPException(409,'idempotency key already used for different feedback')
            return {'id':old.id,**old.detail,'source':'declared','createdAt':old.created_at.isoformat()}
    kwargs={'id':rid} if rid else {}
    row=ActivityLog(**kwargs,actor='user',action='quality_feedback',project_id=p.id,summary='用户创作反馈',detail=d)
    session.add(row)
    if body.artifact_id:
        session.add(EvalCaseCandidate(artifact_id=body.artifact_id,artifact_version=body.artifact_version,project_id=p.id,signal='user_quality_feedback',status='triage',detail={'feedbackId':row.id,'source':'declared','decision':body.decision,'outcome':body.outcome,'reason':body.reason}))
    try:session.commit()
    except IntegrityError:
        session.rollback();old=session.get(ActivityLog,rid)
        if not old or old.detail!=d:raise HTTPException(409,'feedback conflict')
        row=old
    session.refresh(row)
    return {'id':row.id,**row.detail,'source':'declared','createdAt':row.created_at.isoformat()}
@router.get('/personalization/profile')
def get_profile(session:Session=Depends(get_session)):return learning.profile(session)
@router.patch('/personalization/profile')
def patch_profile(body:ProfileIn,session:Session=Depends(get_session)):
    cfg=learning.profile(session)
    if body.enabled is not None:cfg['enabled']=body.enabled
    if body.preferences is not None:cfg['preferences']=[{'text':p.text.strip(),'format':p.format} for p in body.preferences if p.text.strip()]
    row=session.get(AppSetting,learning.profile_key()) or AppSetting(key=learning.profile_key())
    row.value_json=cfg;row.updated_at=utcnow();session.add(row);session.commit()
    return cfg
@router.post('/personalization/profile/reset')
def reset_profile(session:Session=Depends(get_session)):
    cfg={'enabled':False,'preferences':[],'resetAt':utcnow().replace(tzinfo=None).isoformat()}
    row=session.get(AppSetting,learning.profile_key()) or AppSetting(key=learning.profile_key());row.value_json=cfg;row.updated_at=utcnow();session.add(row);session.commit();return cfg

@router.get('/projects/{project_id}/personalization-context')
def get_context(project_id:str,session:Session=Depends(get_session)):
    return {'context':learning.context(session,must_project(session,project_id))}
