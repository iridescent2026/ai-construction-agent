import hashlib,time
from types import SimpleNamespace
import pytest
from fastapi import HTTPException
from common.database import connect
from gis.factory_workspaces import Workspaces
from test_access_operations import system,workspace

def manager(tmp_path):
    return Workspaces(SimpleNamespace(state=SimpleNamespace(factory=SimpleNamespace(demo_enabled=True))),tmp_path/'spaces.db')

def test_only_recently_used_spaces_consume_runtime_capacity(tmp_path,monkeypatch):
    monkeypatch.delenv('DATABASE_URL',raising=False)
    m=manager(tmp_path)
    tokens=[m.create('test-'+str(i))['workspace'] for i in range(20)]
    assert m.inventory()['active']==20
    with pytest.raises(HTTPException) as full:m.create('another')
    assert full.value.status_code==429
    with connect(m.path) as db:db.execute('UPDATE workspace_activity SET last_seen=?',(time.time()-601,))
    m.tick()
    assert m.inventory()['active']==0 and m.inventory()['retained']==20
    assert m.create('new-visitor')['workspace']
    with connect(m.path) as db:
        assert db.execute('SELECT COUNT(*) FROM workspaces').fetchone()[0]==21
        assert db.execute('SELECT expires FROM workspaces WHERE id=?',(hashlib.sha256(tokens[0].encode()).hexdigest(),)).fetchone()[0]>time.time()

def test_idle_resume_preserves_observations_and_login_identity(system):
    app,client=system;headers=workspace(client);m=app.state.workspaces
    body={'observations':[{'id':'B-05','measurements':{'temperature':{'value':79,'unit':'℃'}}}]}
    assert client.post('/factory/observations',headers=headers,json=body).status_code==200
    key=hashlib.sha256(headers['X-Demo-Workspace'].encode()).hexdigest()
    with connect(m.path) as db:
        original=db.execute('SELECT expires FROM workspaces WHERE id=?',(key,)).fetchone()[0]
        db.execute('UPDATE workspace_activity SET last_seen=? WHERE id=?',(time.time()-601,key))
    m.tick();assert key not in m.children
    response=client.get('/factory/state',headers=headers)
    assert response.status_code==200
    e=next(e for e in response.json()['entities'] if e['id']=='B-05')
    assert e['measurements']['temperature']['value']==79
    with connect(m.path) as db:assert db.execute('SELECT expires FROM workspaces WHERE id=?',(key,)).fetchone()[0]==original
    assert client.get('/factory/auth/me',headers=headers).json()['id']=='demo-safety'

def test_existing_schema_migration_does_not_reserve_slots_without_activity(tmp_path,monkeypatch):
    monkeypatch.delenv('DATABASE_URL',raising=False)
    p=tmp_path/'spaces.db'
    with connect(p) as db:
        db.execute('CREATE TABLE workspaces (id TEXT PRIMARY KEY,expires DOUBLE PRECISION)')
        for i in range(20):db.execute('INSERT INTO workspaces VALUES(?,?)',(hashlib.sha256(str(i).encode()).hexdigest(),time.time()+86400))
    m=manager(tmp_path)
    assert m.inventory()['retained']==20 and m.inventory()['active']==0
    assert m.create('visitor')['workspace']

def test_expired_cleanup_is_reversible_archive_not_data_deletion(tmp_path,monkeypatch):
    monkeypatch.delenv('DATABASE_URL',raising=False)
    m=manager(tmp_path);token=m.create()['workspace'];key=hashlib.sha256(token.encode()).hexdigest()
    with connect(m.path) as db:db.execute('UPDATE workspaces SET expires=? WHERE id=?',(time.time()-1,key))
    m.tick();m.tick()
    assert m.inventory()['archived']==1 and len(m.inventory()['history'])==1
    with connect(m.path) as db:assert db.execute('SELECT id FROM workspaces WHERE id=?',(key,)).fetchone()
    with pytest.raises(HTTPException):m.child(token)
    m.archive(key,{'id':'project-admin'},restore=True)
    assert m.inventory()['archived']==0

def test_old_idle_space_cannot_exceed_concurrent_limit(system):
    app,client=system;headers=workspace(client);m=app.state.workspaces
    with connect(m.path) as db:db.execute('UPDATE workspace_activity SET last_seen=?',(time.time()-601,))
    for i in range(20):m.create('visitor-'+str(i))
    assert client.get('/factory/state',headers=headers).status_code==429
    assert m.inventory()['active']==20
