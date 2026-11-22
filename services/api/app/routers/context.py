from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from ..db import get_session
from ..context_refs import resolve_refs, artifact_text
from ..schemas import ContextResolveIn, ContextResolveOut, ContextSourceOut
from ..models import Artifact

router = APIRouter(prefix='/context', tags=['context'])


@router.post('/resolve', response_model=ContextResolveOut)
def resolve_context(body: ContextResolveIn, session: Session = Depends(get_session)) -> ContextResolveOut:
    return resolve_refs(session, body.refs)


@router.get('/artifacts/{artifact_id}/text', response_model=ContextSourceOut)
def artifact_source_text(artifact_id: str, session: Session = Depends(get_session)) -> ContextSourceOut:
    row = session.get(Artifact, artifact_id)
    if not row:
        raise HTTPException(404, '引用产物不存在')
    text = artifact_text(row)
    if len(text) > 500_000:
        raise HTTPException(422, '资料过长，请先拆分稿件再引用')
    return ContextSourceOut(text=text, title=row.title, version=row.version, project_id=row.project_id)
