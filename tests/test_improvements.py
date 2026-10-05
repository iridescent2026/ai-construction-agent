import json
from datetime import datetime, timedelta, timezone
import httpx
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from test_p0 import modules


@pytest.fixture
def connected(modules,monkeypatch):
    e,g,a=modules
    original=httpx.AsyncClient
    class Transport(httpx.AsyncBaseTransport):
        async def handle_async_request(self,request):
            return await httpx.ASGITransport(app=e.app if request.url.port==8001 else g.app).handle_async_request(request)
    monkeypatch.setattr(a.httpx,'AsyncClient',lambda **kwargs:original(transport=Transport(),**kwargs))
    return modules


def test_expired_people_are_unknown_not_current_counts(modules):
    _,g,_=modules
    with g.connect() as db:
        row=json.loads(db.execute("SELECT payload FROM people WHERE id='P001'").fetchone()[0])
        row['timestamp']=(datetime.now(timezone.utc)-timedelta(minutes=3)).isoformat()
        db.execute("UPDATE people SET payload=? WHERE id='P001'",(json.dumps(row),))
    state=TestClient(g.app).get('/state').json()
    assert state['unknown_people']==1 and state['fresh_people']==4
    assert state['heatmap'][0]['people_count']==0
    assert next(r for r in state['results'] if r['person_id']=='P001')['risk_level']=='未知'


def test_demo_refresh_does_not_move_people(modules):
    _,g,_=modules
    c=TestClient(g.app)
    before=c.get('/people').json()['people']
    result=c.post('/simulation/tick').json()
    assert result['state']['fresh_people']==5
    assert [(p['lng'],p['lat']) for p in before]==[(p['lng'],p['lat']) for p in result['state']['people']]


@pytest.mark.parametrize('module_index',[0,1])
def test_production_mode_blocks_simulation(modules,monkeypatch,module_index):
    monkeypatch.setenv('DEMO_MODE','0')
    assert TestClient(modules[module_index].app).post('/simulation/tick').status_code==403


def test_simulation_cannot_overwrite_ingested_data(modules):
    e,g,_=modules
    ec,gc=TestClient(e.app),TestClient(g.app)
    ec.post('/telemetry',json={'readings':[{'device_id':'D001','load':99,'temperature':70,'leakage':0.1}]})
    before=ec.get('/devices').json()
    assert ec.post('/simulation/tick').status_code==409
    assert ec.get('/devices').json()==before
    gc.post('/check_danger',json={'person_id':'P001','lng':120.008,'lat':30.2945})
    before=gc.get('/state').json()
    assert gc.post('/simulation/tick').status_code==409
    assert gc.get('/state').json()==before


@pytest.mark.parametrize('module_index',[0,1,2])
def test_foreign_origin_is_rejected(modules,module_index):
    c=TestClient(modules[module_index].app)
    assert c.get('/health',headers={'Origin':'https://untrusted.example'}).status_code==403
    assert c.get('/health',headers={'Origin':'http://127.0.0.1:18080'}).status_code==200


def test_foreign_simple_post_does_not_mutate(modules):
    e,_,a=modules
    c=TestClient(e.app);before=c.get('/devices').json()
    assert c.post('/simulation/tick',headers={'Origin':'https://untrusted.example'}).status_code==403
    assert c.get('/devices').json()==before
    with pytest.raises(WebSocketDisconnect):
        with TestClient(a.app).websocket_connect('/ws/data',headers={'Origin':'https://untrusted.example'}):
            pass


def test_overview_counts_unique_people_and_uses_same_scoring(connected):
    e,g,a=connected
    g.zones.append({**g.zones[0],'zone_id':'OVERLAP'})
    c=TestClient(a.app)
    risk=c.get('/risk').json();dashboard=c.get('/dashboard').json()
    assert risk==dashboard
    assert risk['total_people']==5
    assert risk['high_risk_people']==2
    assert risk['overall_risk']==0.85
    assert risk['data_complete']


def test_incomplete_data_is_not_reported_as_zero_risk(connected):
    e,g,a=connected
    with g.connect() as db:
        p=json.loads(db.execute("SELECT payload FROM people WHERE id='P001'").fetchone()[0]);p['timestamp']='2000-01-01T00:00:00+00:00'
        db.execute("UPDATE people SET payload=? WHERE id='P001'",(json.dumps(p),))
    c=TestClient(a.app)
    result=c.get('/risk').json()
    assert result['overall_risk'] is None and not result['data_complete']
    assert '数据不完整' in c.post('/chat',params={'query':'当前风险'}).json()['answer']


def test_history_reads_retained_observations_without_fake_rows(connected):
    e,g,a=connected
    c=TestClient(a.app)
    today=datetime.now(timezone(timedelta(hours=8))).date().isoformat()
    before=a.conn.execute('SELECT COUNT(*) FROM risk_history').fetchone()[0]
    first=c.get('/history/'+today).json()
    assert first['source']=='stored_observations' and len(first['history'])==8
    assert c.get('/history/'+today).json()==first
    assert a.conn.execute('SELECT COUNT(*) FROM risk_history').fetchone()[0]==before
    assert c.get('/history/2000-01-01').json()['history']==[]
    assert c.get('/history/not-a-date').status_code==422


def test_progress_is_stable_and_never_reduces_risk(modules):
    _,_,a=modules
    c=TestClient(a.app)
    assert c.get('/progress').json()==c.get('/progress').json()
    assert c.get('/progress').json()['is_live'] is False
    for deviation in [-10,0,10]:
        assert a.calc_schedule_factor(deviation)[0]==1


def test_upstream_failure_returns_unknown(modules,monkeypatch):
    _,_,a=modules
    original=httpx.AsyncClient
    async def fail(request):raise httpx.ConnectError('offline')
    monkeypatch.setattr(a.httpx,'AsyncClient',lambda **kwargs:original(transport=httpx.MockTransport(fail),**kwargs))
    c=TestClient(a.app)
    assert c.get('/risk').status_code==503
    assert c.get('/history/2026-10-05').status_code==503
    assert not c.post('/chat',params={'query':'当前风险'}).json()['success']
    assert c.get('/export/csv?site_id=unconfigured').status_code==404
