import json
import sqlite3
from datetime import datetime, timedelta, timezone
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from common.runtime import configure_api
from gis.factory import install_factory, Batch, Observation

PASSWORDS={'safety':'SafetyDemo!2026','maintenance':'RepairDemo!2026','reviewer':'ReviewDemo!2026','observer':'ObserveDemo!2026'}

@pytest.fixture
def system(tmp_path,monkeypatch):
    monkeypatch.setenv('FACTORY_DB_PATH',str(tmp_path/'factory.db'))
    monkeypatch.setenv('DEMO_MODE','1');monkeypatch.setenv('FACTORY_ANALYSIS_DEMO','0')
    monkeypatch.delenv('FACTORY_ACCOUNTS_JSON',raising=False)
    app=FastAPI();configure_api(app);install_factory(app)
    with TestClient(app) as client:yield app,client

def login(client,role):
    result=client.post('/factory/auth/login',json={'username':'demo-'+role,'password':PASSWORDS[role]})
    assert result.status_code==200,result.text
    return {'Authorization':'Bearer '+result.json()['token']}

def order_action(client,order,action,headers,**values):
    return client.post('/factory/analysis/orders/'+order['id'],headers=headers,json={'action':action,'expectedVersion':order['version'],**values})

def test_five_questions_use_one_factory_version_and_no_chat_side_effects(system):
    app,client=system
    for query,intent in [('B-05 现在是什么状态？','status'),('B-05 可能影响哪里？','impact'),('B-05 涉及哪些人员和作业？','people'),('B-05 处理后怎么关闭？','review')]:
        result=client.post('/factory/workflow/chat',json={'query':query}).json()
        assert result['intent']==intent and result['engine']=='rule-tool-orchestrator'
        assert len(result['tool_calls'])==5
        assert {t['factoryRevision'] for t in result['tool_results']}=={result['case']['factoryRevision']}
        assert result['case']['observation']['status']=='pending'
        assert result['case']['observation']['missingMeasurements']==['flow']
    assert not client.get('/factory/analysis').json()['orders']
    assert client.post('/factory/workflow/chat',json={'query':'请帮我画图'}).json()['tool_calls']==[]
    assert client.post('/factory/workflow/chat',json={'query':'B-99 状态'}).status_code==404

def test_manual_observation_provenance_and_expired_data_never_safe(system):
    app,client=system;headers=login(client,'safety')
    payload={'observations':[{'id':'B-05','observedAt':(datetime.now(timezone.utc)-timedelta(seconds=300)).isoformat(),'measurements':{'temperature':{'value':70,'unit':'℃'}}}]}
    assert client.post('/factory/observations',json=payload).status_code==401
    saved=client.post('/factory/observations',json=payload,headers=headers).json()
    entity=next(e for e in saved['entities'] if e['id']=='B-05')
    assert entity['measurementProvenance']['kind']=='manual'
    result=client.get('/factory/workflow/case/B-05?useTestRule=true').json()
    assert result['observation']['status']=='unknown'
    assert result['observation']['source']=='手动测试导入'
    assert result['impact']['hasUnverified']
    assert client.post('/factory/observations',json={'observations':[{'id':'B-05','measurements':{'flow':{'value':1,'unit':'m³/h'}}}]},headers=headers).status_code==422

@pytest.mark.parametrize('value,expected',[(40,'test_clear'),(65,'test_alert')])
def test_flow_test_conditions_are_explicit_and_do_not_create_engineering_rules(system,value,expected):
    app,client=system;headers=login(client,'safety')
    client.post('/factory/observations',json={'observations':[{'id':'B-05','measurements':{'temperature':{'value':value,'unit':'℃'}}}]},headers=headers)
    result=client.get('/factory/workflow/case/B-05?useTestRule=true').json()
    assert result['observation']['status']==expected
    assert result['observation']['rule']['status']=='设计假设'
    assert '工程限值' in result['observation']['rule']['basis']
    assert client.get('/factory/workflow/case/B-05').json()['observation']['status']=='pending'
    app.state.factory.demo_enabled=False
    assert client.get('/factory/workflow/case/B-05?useTestRule=true',headers=headers).status_code==403

def test_account_permission_no_actor_spoofing_and_complete_loop(system):
    app,client=system;safety=login(client,'safety');maintenance=login(client,'maintenance');reviewer=login(client,'reviewer');observer=login(client,'observer')
    assert client.post('/factory/workflow/chat',json={'query':'安排 B-05 核查'}).status_code==401
    assert client.post('/factory/workflow/drafts',json={},headers=observer).status_code==403
    drafted=client.post('/factory/workflow/chat',json={'query':'B-05 帮我安排核查任务'},headers=safety).json()
    assert '尚未创建' in drafted['answer'] and not client.get('/factory/analysis').json()['orders']
    draft=drafted['draft'];url='/factory/workflow/drafts/'+draft['id']+'/confirm'
    assert client.post(url,json={'assignee':'fake'},headers=safety).status_code==422
    assert client.post(url,json={'assignee':'demo-maintenance'},headers=observer).status_code==403
    created=client.post(url,json={'assignee':'demo-maintenance'},headers=safety).json();order=created['order']
    assert order['status']=='assigned' and order['assignee']=='demo-maintenance'
    assert order['history'][0]['actor']=='demo-safety'
    assert order['trigger']['workflowCase']['reviewed']['factoryRevision']==draft['case']['factoryRevision']
    again=client.post(url,json={'assignee':'demo-maintenance'},headers=safety).json()
    assert again['alreadyConfirmed'] and again['order']['id']==order['id']
    assert len(client.get('/factory/analysis').json()['orders'])==1
    assert order_action(client,order,'start',observer,actor='demo-maintenance').status_code==403
    order=order_action(client,order,'start',maintenance,actor='fake-reviewer').json()
    assert order['history'][-1]['actor']=='demo-maintenance'
    assert order_action(client,order,'complete',maintenance).status_code==422
    order=order_action(client,order,'complete',maintenance,note='原型核查记录：已核对模拟读数和候选连接，现场依据待核验。').json()
    assert order_action(client,order,'approve',maintenance,actor='demo-reviewer',note='尝试换名自审').status_code==403
    assert order_action(client,order,'approve',reviewer,expectedVersion=1,note='过期版本').status_code==409
    order=order_action(client,order,'approve',reviewer,note='已复核原型测试凭证，不代表现场维修验收。').json()
    assert order['status']=='closed' and order['reviewedBy']=='demo-reviewer'
    # Protected legacy endpoints cannot bypass authenticated identity.
    assert client.post('/factory/analysis/orders',json={'entityId':'B-05','reason':'绕过账号','actor':'管理员'}).status_code==401
    assert client.post('/factory/analysis/plans',json={'plans':[]},headers=observer).status_code==403

def test_draft_expiry_changed_basis_and_failed_commit_leave_no_order(system,monkeypatch):
    app,client=system;headers=login(client,'safety')
    draft=client.post('/factory/workflow/drafts',json={},headers=headers).json()
    with app.state.factory_analysis.connect() as db:
        db.execute('UPDATE investigation_drafts SET expires=0 WHERE id=?',(draft['id'],))
    assert client.post('/factory/workflow/drafts/'+draft['id']+'/confirm',json={'assignee':'demo-maintenance'},headers=headers).status_code==409
    draft=client.post('/factory/workflow/drafts',json={},headers=headers).json()
    app.state.factory.observe(Batch(observations=[Observation(id='B-05',measurements={'temperature':{'value':45,'unit':'℃'}})]))
    assert client.post('/factory/workflow/drafts/'+draft['id']+'/confirm',json={'assignee':'demo-maintenance'},headers=headers).status_code==409
    draft=client.post('/factory/workflow/drafts',json={},headers=headers).json()
    def failure(*args):raise sqlite3.OperationalError('simulated disk failure')
    monkeypatch.setattr(app.state.factory_analysis,'put',failure)
    with pytest.raises(sqlite3.OperationalError):
        client.post('/factory/workflow/drafts/'+draft['id']+'/confirm',json={'assignee':'demo-maintenance'},headers=headers)
    assert not client.get('/factory/analysis').json()['orders']
    with app.state.factory_analysis.connect() as db:
        assert db.execute('SELECT order_id FROM investigation_drafts WHERE id=?',(draft['id'],)).fetchone()[0] is None

def test_credentials_logout_and_real_mode_disable_public_demo_accounts(system,monkeypatch):
    app,client=system;headers=login(client,'safety')
    assert client.get('/factory/auth/me',headers=headers).json()['id']=='demo-safety'
    assert client.post('/factory/auth/logout',headers=headers,json={}).status_code==200
    assert client.get('/factory/auth/me',headers=headers).status_code==401
    for _ in range(10):assert client.post('/factory/auth/login',json={'username':'bad','password':'bad'}).status_code==401
    assert client.post('/factory/auth/login',json={'username':'bad','password':'bad'}).status_code==429
    from gis.factory_accounts import Accounts
    accounts=Accounts(app.state.factory_accounts.path,False)
    with pytest.raises(Exception) as error:accounts.login(type('LoginValue',(),{'username':'demo-safety','password':PASSWORDS['safety']})())
    assert getattr(error.value,'status_code',None)==401
    assert not accounts.has_accounts()

def test_unknown_people_and_absent_plans_are_explicit(system):
    app,client=system
    with app.state.factory.lock:
        for entity in app.state.factory.data['entities']:
            if entity['kind']=='person' and entity['view']=='b':entity['positionTimestamp']=None
    result=client.get('/factory/workflow/case/B-05').json()
    assert result['people']['unknownInWorkArea'] and not result['people']['valid']
    assert result['workPlans']['configuredCount']==0
    assert '不代表' in result['workPlans']['basis']
