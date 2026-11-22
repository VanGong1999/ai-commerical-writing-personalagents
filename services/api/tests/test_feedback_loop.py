import pytest
from sqlmodel import Session,SQLModel,create_engine
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient
from app.main import app,api
from app.db import get_session
from app.models import Project,Artifact
from app.settings import get_settings
@pytest.fixture
def client():
 e=create_engine('sqlite://',connect_args={'check_same_thread':False},poolclass=StaticPool);SQLModel.metadata.create_all(e)
 def db():
  with Session(e) as s:yield s
 api.dependency_overrides[get_session]=db
 with Session(e) as s:
  s.add(Project(id='p',user_id=get_settings().demo_user_id,title='test',format='manju',stage='S0_SETUP'))
  s.add(Project(id='sandbox',user_id=get_settings().demo_user_id,title='eval',format='manju',stage='S0_SETUP',status='eval_sandbox'))
  for aid in ['sa','sb','sc']:s.add(Artifact(id=aid,project_id='sandbox',type='manuscript',title='eval',version=1))
  s.add(Project(id='foreign',user_id='another',title='other',format='manju',stage='S0_SETUP'))
  
  for aid in ['a','b','c']:s.add(Artifact(id=aid,project_id='p',type='manuscript',title='test',version=1))
  s.commit()
 yield TestClient(app)
 api.dependency_overrides.pop(get_session,None);e.dispose()
def test_missing_results_remain_unknown_not_zero(client):
 r=client.post('/api/v1/projects/p/feedback-loop',json={'artifactId':'a','decision':'adopt'});assert r.status_code==200
 d=r.json();assert d['outcome']=='unknown' and d['manualMinutes'] is None and d['revenue'] is None
 assert client.get('/api/v1/projects/p/feedback-loop').json()['personalization']['context']==''
def test_feedback_bound_to_source_version_and_idempotent(client):
 data={'artifactId':'a','artifactVersion':1,'decision':'revise','idempotencyKey':'one'}
 a=client.post('/api/v1/projects/p/feedback-loop',json=data);b=client.post('/api/v1/projects/p/feedback-loop',json=data);assert a.json()['id']==b.json()['id']
 assert client.post('/api/v1/projects/p/feedback-loop',json={**data,'decision':'discard'}).status_code==409
 assert client.post('/api/v1/projects/p/feedback-loop',json={'artifactId':'a','artifactVersion':999,'decision':'adopt'}).status_code==409
 assert client.get('/api/v1/projects/foreign/feedback-loop').status_code==404
def test_repeated_explicit_feedback_personalizes_then_reset_disables(client):
 for aid in ['a','b','c']:assert client.post('/api/v1/projects/p/feedback-loop',json={'artifactId':aid,'decision':'revise','reason':'W15'}).status_code==200
 d=client.get('/api/v1/projects/p/feedback-loop').json();assert d['personalization']['suggestions'][0]['evidenceCount']==3
 assert d['personalization']['context']==''
 assert {s['artifactId'] for s in d['personalization']['suggestions'][0]['sources']}=={'a','b','c'}
 assert client.post('/api/v1/personalization/profile/reset').status_code==200
 d=client.get('/api/v1/projects/p/feedback-loop').json();assert d['personalization']['context']=='' and d['personalization']['suggestions']==[]
 assert len(d['events'])==3
def test_preferences_are_bounded_and_format_scoped(client):
 assert client.patch('/api/v1/personalization/profile',json={'preferences':[{'text':'短句','format':'male_long'}]}).status_code==200
 assert client.get('/api/v1/projects/p/feedback-loop').json()['personalization']['context']==''
 assert client.patch('/api/v1/personalization/profile',json={'preferences':[{'text':'具体动作','format':'manju'}]}).status_code==200
 assert '具体动作' in client.get('/api/v1/projects/p/feedback-loop').json()['personalization']['context']
 assert client.post('/api/v1/projects/p/feedback-loop',json={'revenue':-1}).status_code==422
 assert client.post('/api/v1/projects/p/feedback-loop',json={}).status_code==422

def test_repeated_clicks_do_not_invent_independent_preference_evidence(client):
 for _ in range(3):client.post('/api/v1/projects/p/feedback-loop',json={'artifactId':'a','decision':'revise','reason':'W15'})
 assert client.get('/api/v1/projects/p/feedback-loop').json()['personalization']['suggestions']==[]

def test_evaluation_feedback_does_not_leak_into_personalized_generation(client):
 for aid in ['sa','sb','sc']:client.post('/api/v1/projects/sandbox/feedback-loop',json={'artifactId':aid,'decision':'revise','reason':'W15'})
 assert client.get('/api/v1/projects/p/feedback-loop').json()['personalization']['suggestions']==[]

def test_exact_natural_feedback_labels_can_improve_future_context_without_forms(client):
 for aid in ['a','b','c']:client.post('/api/v1/projects/p/feedback-loop',json={'artifactId':aid,'decision':'revise','reason':'对白太长'})
 personalization=client.get('/api/v1/projects/p/feedback-loop').json()['personalization']
 assert '对白更简练' in personalization['suggestions'][0]['text']
 assert personalization['context']==''


def test_unbound_conversations_use_only_curated_global_preferences(client):
 from app.feedback_loop import conversation_context
 client.patch('/api/v1/personalization/profile',json={'preferences':[{'text':'简洁'},{'text':'分镜','format':'manju'}]})
 with next(api.dependency_overrides[get_session]()) as session:
  assert '简洁' in conversation_context(session,None)
  assert '分镜' not in conversation_context(session,None)
  assert '简洁' in conversation_context(session,'p')
  assert conversation_context(session,'foreign')==''
 client.patch('/api/v1/personalization/profile',json={'enabled':False})
 with next(api.dependency_overrides[get_session]()) as session:
  assert conversation_context(session,None)==''


def test_opposing_feedback_preserves_curated_context_until_reset(client):
 from app.feedback_loop import conversation_context

 profile_url='/api/v1/personalization/profile'
 loop_url='/api/v1/projects/p/feedback-loop'
 preference={'text':'对白保留长句和详细解释','format':'*'}
 assert client.patch(profile_url,json={'enabled':True,'preferences':[preference]}).status_code==200
 expected=client.get(loop_url).json()['personalization']['context']
 assert expected.endswith('\n- '+preference['text'])
 for artifact_id in ['a','b','c']:
  response=client.post(loop_url,json={'artifactId':artifact_id,'decision':'revise','reason':'对白太长'})
  assert response.status_code==200
 state=client.get(loop_url).json()['personalization']
 assert state['suggestions'][0]['text']=='对白更简练，避免冗长解释'
 assert state['context']==expected
 assert client.post(profile_url+'/reset').status_code==200
 assert client.get(profile_url).json()['preferences']==[]
 assert client.patch(profile_url,json={'enabled':True}).json()['preferences']==[]
 db=api.dependency_overrides[get_session]()
 try:
  session=next(db)
  assert conversation_context(session,None)==''
  assert conversation_context(session,'p')==''
 finally:
  db.close()
