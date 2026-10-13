import json
from datetime import datetime, timedelta, timezone
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from gis.factory import install_factory
from gis.factory_analysis import WorkPlan, conflicts
from gis.factory_operations import checksum
from gis.workflow_language import interpret

@pytest.fixture
def system(tmp_path, monkeypatch):
    for key,value in {'FACTORY_DB_PATH':str(tmp_path/'factory.db'),'DEMO_MODE':'1','FACTORY_ANALYSIS_DEMO':'0','DEMO_WORKSPACES_REQUIRED':'1'}.items(): monkeypatch.setenv(key,value)
    for key in ('DATABASE_URL','FACTORY_ACCOUNTS_JSON','WORKFLOW_MODEL_ENABLED'): monkeypatch.delenv(key,raising=False)
    app=FastAPI();install_factory(app)
    with TestClient(app) as client:yield app,client

def signin(client, headers, role):
    passwords={'safety':'SafetyDemo!2026','observer':'ObserveDemo!2026','admin':'AdminDemo!2026','reviewer':'ReviewDemo!2026'}
    response=client.post('/factory/auth/login',headers=headers,json={'username':'demo-'+role,'password':passwords[role]})
    assert response.status_code==200,response.text
    return {'Authorization':'Bearer '+response.json()['token']}


def test_official_admin_login_with_workspace_isolation(tmp_path,monkeypatch):
    monkeypatch.delenv('DATABASE_URL',raising=False)
    monkeypatch.delenv('FACTORY_ACCOUNTS_JSON',raising=False)
    monkeypatch.setenv('FACTORY_DB_PATH',str(tmp_path/'official.db'))
    monkeypatch.setenv('DEMO_MODE','1')
    monkeypatch.setenv('DEMO_WORKSPACES_REQUIRED','1')
    monkeypatch.setenv('FACTORY_ANALYSIS_DEMO','0')
    monkeypatch.setenv('FACTORY_ADMIN_PASSWORD','LocalAdminTest!2026')
    app=FastAPI();install_factory(app)
    with TestClient(app) as client:
        login=client.post('/factory/auth/login',json={'username':'project-admin','password':'LocalAdminTest!2026'})
        assert login.status_code==200
        headers={'Authorization':'Bearer '+login.json()['token']}
        me=client.get('/factory/auth/me',headers=headers)
        assert me.status_code==200 and me.json()['role']=='admin'
        assert client.get('/factory/auth/manage',headers=headers).status_code==200

def workspace(client,role='safety'):
    headers={'X-Demo-Workspace':client.post('/factory/auth/demo-session').json()['workspace']}
    return headers|signin(client,headers,role)

def test_scoped_observations_orders_and_sessions(system):
    _,client=system;one=workspace(client);two=workspace(client)
    assert client.get('/factory/state').status_code==401
    assert client.get('/factory/state',headers={'X-Demo-Workspace':one['X-Demo-Workspace']}).status_code==401
    assert client.get('/factory/state',headers=two|{'Authorization':one['Authorization']}).status_code==401
    body={'observations':[{'id':'B-05','measurements':{'temperature':{'value':79,'unit':'℃'}}}]}
    assert client.post('/factory/observations',headers=one,json=body).status_code==200
    def temperature(headers):return next(e for e in client.get('/factory/state',headers=headers).json()['entities'] if e['id']=='B-05')['measurements']['temperature']['value']
    assert temperature(one)==79 and temperature(two)!=79
    assert client.post('/factory/analysis/orders',headers=one,json={'entityId':'B-05','reason':'隔离核查'}).status_code==200
    assert not client.get('/factory/analysis',headers=two).json()['orders']

def test_demo_controls_require_authorized_role(system):
    _,client=system;headers=workspace(client,'observer')
    for path,body in [('/factory/demo',{'action':'start','key':'outdoor'}),('/factory/analysis/demo-feed',{'action':'start'})]:
        assert client.post(path,headers=headers,json=body).status_code==403
        assert client.post(path,headers=headers|signin(client,headers,'safety'),json=body).status_code==200

def test_admin_management_password_revocation_and_restart(system):
    app,client=system;admin=workspace(client,'admin');observer=admin|signin(client,admin,'observer')
    command={'id':'alice','name':'测试人员','role':'maintenance','password':'AliceStart!2026'}
    assert client.post('/factory/auth/manage',headers=observer,json=command).status_code==403
    assert client.post('/factory/auth/manage',headers=admin,json=command).status_code==200
    def login(password):return client.post('/factory/auth/login',headers={'X-Demo-Workspace':admin['X-Demo-Workspace']},json={'username':'alice','password':password})
    alice={'X-Demo-Workspace':admin['X-Demo-Workspace'],'Authorization':'Bearer '+login('AliceStart!2026').json()['token']}
    assert client.post('/factory/auth/profile',headers=alice,json={'name':'新姓名','department':'机电','avatar':'initials'}).json()['name']=='新姓名'
    assert client.post('/factory/auth/password',headers=alice,json={'currentPassword':'AliceStart!2026','newPassword':'AliceChanged!2026'}).status_code==200
    assert client.get('/factory/auth/me',headers=alice).status_code==401
    import hashlib
    from gis.factory_accounts import Accounts,Login
    child=app.state.workspaces.children[hashlib.sha256(admin['X-Demo-Workspace'].encode()).hexdigest()]
    reopened=Accounts(child.state.factory_accounts.path,True,sandbox=True)
    assert reopened.login(Login(username='alice',password='AliceChanged!2026'))['user']['name']=='新姓名'
    assert client.post('/factory/auth/manage/alice',headers=admin,json={'role':'maintenance','enabled':False}).status_code==200
    assert login('AliceChanged!2026').status_code==403
    assert client.post('/factory/auth/manage/demo-admin',headers=admin,json={'role':'observer','enabled':False}).status_code==409
    assert all('password' not in r and 'digest' not in r for r in client.get('/factory/auth/manage',headers=admin).json())

def test_checked_backup_restore_keeps_identity_and_previous_backup(system):
    _,client=system;admin=workspace(client,'admin');safety=admin|signin(client,admin,'safety')
    assert client.get('/factory/operations/backup',headers=safety).status_code==403
    client.post('/factory/analysis/orders',headers=safety,json={'entityId':'B-05','reason':'备份测试工单'})
    backup=client.get('/factory/operations/backup',headers=admin).json()
    assert backup['documents']['orders'] and 'sessions' not in backup and 'users' not in backup
    changed=json.loads(json.dumps(backup));changed['documents']['orders']=[]
    def restore():return client.post('/factory/operations/restore',headers=admin,json={'backup':changed,'expectedRevision':client.get('/factory/state',headers=admin).json()['revision'],'confirmation':'恢复本项目备份'})
    assert restore().status_code==422
    assert client.get('/factory/analysis',headers=admin).json()['orders']
    changed.pop('checksum');changed['checksum']=checksum(changed)
    assert restore().status_code==200
    assert not client.get('/factory/analysis',headers=admin).json()['orders']
    assert client.get('/factory/operations/before-restore',headers=admin).json()['documents']['orders']
    assert client.get('/factory/auth/me',headers=admin).status_code==200

def test_demo_review_and_practice_never_become_field_evidence(system):
    _,client=system;headers=workspace(client,'reviewer')
    row=client.post('/factory/operations/reviews',headers=headers,json={'subject':'rules','conclusion':'confirmed','reference':'软件测试材料第1页','qualification':'原型复核','note':'仅审阅原型数据'}).json()
    assert row['scope']=='prototype'
    assert client.get('/factory/operations/tasks',headers=headers).json()['evidencePending']==5
    assert client.get('/factory/operations/experiment-summary',headers=headers).json()['medianSavedSeconds'] is None

def plan(id,**kw):
    now=datetime.now(timezone.utc)
    return WorkPlan(id=id,title=id,view='b',startsAt=now,endsAt=now+timedelta(hours=1),center=[0,0],size=[10,10],**kw).model_dump(mode='json')

def test_height_unknown_stays_conservative():
    assert conflicts([plan('a',floor='一层'),plan('b',floor='二层')])[0]['heightKnown'] is False
    assert not conflicts([plan('a',elevation=[0,2]),plan('b',elevation=[3,5])])
    assert conflicts([plan('a',elevation=[0,4]),plan('b',elevation=[3,5])])[0]['overlapHeightM']==1

def test_polygon_and_swept_volume_geometry():
    assert not conflicts([plan('a',polygon=[[0,0],[4,0],[0,4]]),plan('b',polygon=[[4,4],[4,3],[3,4]])])
    assert conflicts([plan('a',trajectory=[[-10,0],[10,0]],sweepRadius=1),plan('b')])
    for extra in [dict(polygon=[[0,0],[4,4],[0,4],[4,0]]),dict(elevation=[4,2]),dict(trajectory=[[0,0],[3,0]])]:
        with pytest.raises(ValueError):plan('invalid',**extra)

@pytest.mark.parametrize('query,expected',[('这台泵现在什么情况，波及哪里？',{'status','impact'}),('周围有人吗，谁来修？',{'people','responsibility'}),('不要创建工单，只查询设备状态',{'status'}),('如何创建工单',{'recommendations'})])
def test_multi_question_and_negated_write_intents(query,expected):
    assert set(interpret(query,'B-05')['intents'])==expected

def test_ambiguous_requests_ask_for_details():
    assert interpret('B-05 与 B-06 比较','B-05')['clarification']
    assert interpret('你好呀','B-05')['clarification']

def test_storage_marker_reads_original_after_process_recreation(system):
    app,client=system;headers=workspace(client,'admin')
    first=client.post('/factory/operations/storage-proof',headers=headers).json()
    assert not first['retainedAfterRestart']
    import hashlib
    child=app.state.workspaces.children[hashlib.sha256(headers['X-Demo-Workspace'].encode()).hexdigest()]
    restarted=FastAPI();install_factory(restarted,path_override=child.state.factory.path,sandbox=True)
    with TestClient(restarted) as again:
        result=again.get('/factory/operations/storage-proof',headers={'Authorization':headers['Authorization']}).json()
        assert result['retainedAfterRestart'] and result['proof']['id']==first['proof']['id']

def test_sandbox_custom_reviewers_cannot_confirm_engineering(system):
    _,client=system;admin=workspace(client,'admin')
    assert client.post('/factory/auth/manage',headers=admin,json={'id':'engineer','name':'原型审阅人','role':'reviewer','password':'EngineerTest!2026'}).status_code==200
    login=client.post('/factory/auth/login',headers={'X-Demo-Workspace':admin['X-Demo-Workspace']},json={'username':'engineer','password':'EngineerTest!2026'}).json()
    reviewer=admin|{'Authorization':'Bearer '+login['token']}
    graph=client.get('/factory/analysis',headers=reviewer).json()['graph']
    for e in graph['edges']:e.update(verified=True,reference='模拟图纸，仅原型测试',reviewer='engineer')
    assert client.post('/factory/analysis/graph',headers=reviewer,json=graph).status_code==200
    impact=client.get('/factory/analysis/impact/B-05',headers=reviewer).json()
    assert impact['hasUnverified'] and all(e['reviewScope']=='prototype' for e in impact['edges'])

def test_restore_does_not_impersonate_review_evidence(system):
    _,client=system;admin=workspace(client,'admin')
    backup=client.get('/factory/operations/backup',headers=admin).json();backup.pop('checksum')
    backup['documents']['engineeringReviews']=[{'subject':'rules','conclusion':'confirmed','reference':'导入材料，未核实真实性','qualification':'声明资质','note':'声明通过，须重新审阅','scope':'recorded_review','reviewer':'someone','at':datetime.now(timezone.utc).isoformat()}]
    backup['checksum']=checksum(backup)
    restored=client.post('/factory/operations/restore',headers=admin,json={'backup':backup,'expectedRevision':client.get('/factory/state',headers=admin).json()['revision'],'confirmation':'恢复本项目备份'})
    assert restored.status_code==200,restored.text
    tasks=client.get('/factory/operations/tasks',headers=admin).json()
    assert tasks['evidencePending']==5 and tasks['reviews'][0]['scope']=='imported_review'

@pytest.mark.parametrize('content,status',[('{"intents":["status","draft"]}','success'),('{"intents":["bypass_auth"]}','fallback'),('not-json','fallback')])
def test_model_classifies_only_and_negated_write_remains_blocked(monkeypatch,content,status):
    import gis.workflow_language as language
    language._RATES.clear();language._DAY=(None,0)
    for k,v in {'WORKFLOW_MODEL_ENABLED':'1','WORKFLOW_MODEL_API_KEY':'test-not-a-real-key','WORKFLOW_MODEL_DAILY_LIMIT':'100'}.items():monkeypatch.setenv(k,v)
    class Response:
        def raise_for_status(self):pass
        def json(self):return {'choices':[{'message':{'content':content}}]}
    def request(url,**kwargs):
        assert url.startswith('https://')
        assert kwargs['json']['model']=='deepseek-flash'
        assert kwargs['json']['thinking']=={'type':'disabled'}
        assert kwargs['json']['messages'][1]['content']=='不要创建工单，只查询设备状态'
        assert 'observations' not in kwargs['json']
        return Response()
    monkeypatch.setattr(language.httpx,'post',request)
    result=interpret('不要创建工单，只查询设备状态','B-05','mock')
    assert result['trace']['status']==status and 'draft' not in result['intents']

def test_model_daily_budget_falls_back_without_another_external_call(monkeypatch):
    import gis.workflow_language as language
    language._RATES.clear();language._DAY=(None,0)
    for k,v in {'WORKFLOW_MODEL_ENABLED':'1','WORKFLOW_MODEL_API_KEY':'test-not-a-real-key','WORKFLOW_MODEL_DAILY_LIMIT':'0'}.items():monkeypatch.setenv(k,v)
    def unexpected(*args,**kwargs):pytest.fail('Must not call a provider after budget is exhausted')
    monkeypatch.setattr(language.httpx,'post',unexpected)
    result=interpret('现在状态','B-05','mock')
    assert result['trace']['status']=='fallback' and result['intents']==['status']
