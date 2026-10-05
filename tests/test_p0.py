import importlib.util
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient
from pyproj import Geod
from shapely.geometry import Polygon, shape

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def modules(tmp_path, monkeypatch):
    monkeypatch.setenv('ELECTRICAL_DB_PATH', str(tmp_path / 'electrical.db'))
    monkeypatch.setenv('GIS_DB_PATH', str(tmp_path / 'gis.db'))
    monkeypatch.setenv('AGENT_DB_PATH', str(tmp_path / 'agent.db'))
    monkeypatch.setenv('DEEPSEEK_API_KEY', '')
    e = load('electrical_test', ROOT / 'electrical/main.py')
    g = load('gis.main', ROOT / 'gis/main.py')
    a = load('agent_test', ROOT / 'math/main.py')
    yield e, g, a
    a.conn.close()


@pytest.mark.parametrize('values', [(0,70,0),(95,20,0),(0,20,0.5),(100,90,0.8)])
def test_single_danger_is_high(modules, values):
    e, _, _ = modules
    d = e.build_device_response(dict(zip(('load','temperature','leakage'),values)))
    assert d['risk_level'] == '高'
    assert d['hard_alert'] and d['risk_score'] >= 0.7
    assert d['alert'].startswith('严重')


def test_safe_values_and_ranking_preserved(modules):
    e, _, _ = modules
    assert e.calc_risk_score(0,20,0) == 0
    d = e.build_device_response({'load':0,'temperature':70,'leakage':0})
    assert d['ranking_score'] == 0.2
    assert not e.danger_reasons(94.99,69.99,0.499)


def test_demo_devices_share_site(modules):
    e, g, _ = modules
    geod = Geod(ellps='WGS84')
    center = g.zones[0]['geometry'].centroid
    for d in e.devices:
        assert geod.inv(center.x,center.y,*d['location'])[2] < 500


def test_all_device_views_same_snapshot_and_reads_do_not_write(modules):
    e, _, _ = modules
    c = TestClient(e.app)
    before = c.get('/devices').json()
    geo = c.get('/devices.geojson').json()
    assert before['snapshot_id'] == geo['snapshot_id']
    assert before['devices'] == [f['properties'] for f in geo['features']]
    history = c.get('/devices/D001/history').json()
    for _ in range(3):
        assert c.get('/devices/D001').json() == before['devices'][0]
        batch = c.post('/devices/batch', json={'device_ids':['D001']}).json()
        assert batch['devices'][0] == before['devices'][0]
    assert c.get('/devices/D001/history').json() == history
    assert c.get('/devices').json() == before


def test_telemetry_persists_and_old_snapshot_remains_addressable(modules):
    e, _, _ = modules
    c = TestClient(e.app)
    original = c.get('/devices').json()
    posted = c.post('/telemetry',json={'readings':[{'device_id':'D001','load':0,'temperature':70,'leakage':0}]}).json()
    assert posted['snapshot_id'] != original['snapshot_id']
    assert posted['devices'][0]['risk_level'] == '高'
    assert c.get('/devices.geojson',params={'snapshot_id':original['snapshot_id']}).json()['features'][0]['properties'] == original['devices'][0]
    e.init_db()
    assert c.get('/devices').json() == posted
    assert len(c.get('/devices/D001/history').json()['history']) == 2


def test_parallel_telemetry_does_not_lose_updates(modules):
    e, _, _ = modules
    def update(i):
        return TestClient(e.app).post('/telemetry',json={'readings':[{'device_id':f'D00{i}','load':99,'temperature':70,'leakage':1}]}).status_code
    with ThreadPoolExecutor(max_workers=4) as pool:
        assert list(pool.map(update,range(1,5))) == [200]*4
    assert all(d['load'] == 99 for d in e.get_devices()['devices'][:4])


def test_invalid_telemetry_is_atomic(modules):
    e, _, _ = modules
    c = TestClient(e.app)
    before = c.get('/devices').json()
    assert c.post('/telemetry',json={'readings':[{'device_id':'missing','load':0,'temperature':20,'leakage':0}]}).status_code == 404
    assert c.post('/telemetry',json={'readings':[{'device_id':'D001','load':-1,'temperature':20,'leakage':0}]}).status_code == 422
    assert c.get('/devices/missing').status_code == 404
    assert c.get('/devices.geojson?snapshot_id=missing').status_code == 404
    assert c.get('/devices').json() == before


def test_only_explicit_simulation_advances_data(modules):
    e, _, _ = modules
    c = TestClient(e.app)
    before = c.get('/devices').json()
    after = c.post('/simulation/tick').json()
    assert before['snapshot_id'] != after['snapshot_id']
    assert c.get('/devices').json() == after


@pytest.mark.parametrize('latitude',[30,60])
@pytest.mark.parametrize('radius',[5,10])
def test_metric_buffers_at_different_latitudes(modules,latitude,radius):
    _, g, _ = modules
    poly = Polygon([(120,latitude),(120.001,latitude),(120.001,latitude+0.001),(120,latitude+0.001)])
    zone = {'zone_id':'Z','zone_type':'测试','risk_level':'高','buffer_radius':radius,'geometry':poly}
    geod = Geod(ellps='WGS84')
    for metres, expected in [(radius-0.05,True),(radius+0.05,False)]:
        lng,lat,_ = geod.fwd(120.0005,latitude+0.001,0,metres)
        result = g.check_person_in_danger('X',lng,lat,[zone])
        assert result['in_buffer'] is expected
        if expected:
            assert result['distance_to_boundary'] == pytest.approx(metres,abs=0.01)
            assert result['distance_unit'] == 'm'
        rendered = shape(g.zone_geojson([zone],buffers=True)['features'][0]['geometry'])
        from shapely.geometry import Point
        assert rendered.covers(Point(lng,lat)) is expected


def test_overlap_order_and_boundary_are_stable(modules):
    _, g, _ = modules
    a = {'zone_id':'A','zone_type':'低区','risk_level':'低','buffer_radius':10,
         'geometry':Polygon([(120,30),(120.001,30),(120.001,30.001),(120,30.001)])}
    b = {**a,'zone_id':'B','risk_level':'高','geometry':Polygon([(120.001,30),(120.002,30),(120.002,30.001),(120.001,30.001)])}
    x = g.check_person_in_danger('P',120.00105,30.0005,[a,b])
    assert x == g.check_person_in_danger('P',120.00105,30.0005,[b,a])
    assert x['inside_zone'] and x['zone_id']=='B' and len(x['matches'])==2
    assert g.check_person_in_danger('P',120.001,30.0005,[a,b])['inside_zone']


def test_position_observations_update_all_views_and_survive_restart(modules):
    _, g, _ = modules
    c = TestClient(g.app)
    response = c.post('/check_danger',json={'person_id':'NEW','lng':120.008,'lat':30.2945}).json()
    summary = c.get('/zone_summary').json()
    assert summary['revision'] == response['revision']
    assert 'NEW' in summary['zones'][0]['people_list']
    assert c.get('/risk_heatmap').json()['heatmap'][0]['people_count'] == summary['zones'][0]['people_count']
    g.init_db()
    assert c.get('/zone_summary').json() == summary
    c.post('/check_danger_batch',json={'people':[{'person_id':'NEW','lng':121,'lat':31}]})
    assert 'NEW' not in c.get('/zone_summary').json()['zones'][0]['people_list']
    state = c.get('/state').json()
    assert next(p for p in state['people'] if p['person_id']=='NEW')['lng'] == 121


def test_preview_does_not_change_state_and_bad_input_rejected(modules):
    _, g, _ = modules
    c = TestClient(g.app)
    before = c.get('/state').json()
    assert c.post('/check_danger_preview',json={'person_id':'X','lng':120.008,'lat':30.2945}).status_code==200
    assert c.post('/check_danger',json={'person_id':'X','lng':999,'lat':999}).status_code==422
    assert c.get('/state').json()==before


ROUTE = {'start_id':'A','points':[{'id':'A','lng':120,'lat':30},{'id':'B','lng':120.001,'lat':30},{'id':'C','lng':120.002,'lat':30.001}]}


@pytest.mark.parametrize('endpoint',['/chat','/chat_llm'])
def test_chat_really_executes_route_and_uses_inputs(modules,monkeypatch,endpoint):
    _, _, a = modules
    original = a.optimize_route
    called = []
    def spy(req):
        called.append(req.model_dump())
        return original(req)
    monkeypatch.setattr(a,'optimize_route',spy)
    c = TestClient(a.app)
    result = c.post(endpoint,params={'query':'规划巡检路线'},json=ROUTE).json()
    assert len(called)==1 and result['success']
    assert result['route_data']['route'][0] == result['route_data']['route'][-1] == 'A'
    assert set(result['route_data']['route']) == {'A','B','C'}
    assert result['route_data']['solver']=='OR-Tools'
    assert result['tool_results'][0]['output']==result['route_data']
    changed = json.loads(json.dumps(ROUTE))
    changed['points'][2]['lng'] += 0.01
    second = c.post(endpoint,params={'query':'规划巡检路线'},json=changed).json()
    assert second['route_data']['total_distance'] > result['route_data']['total_distance']


@pytest.mark.parametrize('endpoint',['/chat','/chat_llm'])
def test_route_missing_input_failure_and_validation(modules,monkeypatch,endpoint):
    _, _, a = modules
    c = TestClient(a.app)
    result = c.post(endpoint,params={'query':'规划巡检路线'}).json()
    assert result['needs_input'] and not result['tool_calls']
    invalid = {**ROUTE,'start_id':'missing'}
    assert c.post(endpoint,params={'query':'巡检'},json=invalid).status_code == 422
    monkeypatch.setattr(a,'optimize_route',lambda _: (_ for _ in ()).throw(RuntimeError('solver failure')))
    failed = c.post(endpoint,params={'query':'巡检'},json=ROUTE).json()
    assert not failed['success'] and not failed['tool_calls']
    assert '未生成' in failed['answer']


@pytest.mark.parametrize('state,expected', [('中','中风险'),('高','高风险'),('关注','需关注'),('stale','未知'),('offline','未知'),('missing','未知')])
def test_electric_summary_does_not_conflate_non_high_with_normal(modules,state,expected):
    e, _, a = modules
    d = e.get_devices()['devices'][0]
    d.update(risk_level='低',alert='正常')
    if state in ('高','中'): d['risk_level']=state
    elif state=='关注': d['alert']='关注：高温'
    elif state=='stale': d['timestamp']=(datetime.now(timezone.utc)-timedelta(minutes=3)).isoformat()
    elif state=='offline': d['status']='offline'
    elif state=='missing': del d['temperature']
    answer=a.summarize_devices([d])['answer']
    assert expected in answer and '所有电气设备正常' not in answer


@pytest.mark.parametrize('endpoint',['/chat','/chat_llm'])
def test_electrical_tool_integration_and_failure(modules,monkeypatch,endpoint):
    e, _, a = modules
    original_client = httpx.AsyncClient
    monkeypatch.setattr(a.httpx,'AsyncClient', lambda **kwargs: original_client(transport=httpx.ASGITransport(app=e.app),base_url='http://test',**kwargs))
    c = TestClient(a.app)
    result = c.post(endpoint,params={'query':'电气设备怎么样'}).json()
    assert result['success'] and '中风险' in result['answer']
    assert result['snapshot_id']==e.get_devices()['snapshot_id']
    async def fail(request): raise httpx.ConnectError('down')
    monkeypatch.setattr(a.httpx,'AsyncClient',lambda **kwargs: original_client(transport=httpx.MockTransport(fail),**kwargs))
    failed=c.post(endpoint,params={'query':'电气设备怎么样'}).json()
    assert not failed['success'] and '未知' in failed['answer']


def test_llm_classified_route_and_electric_use_same_safe_tools(modules,monkeypatch):
    _, _, a = modules
    c=TestClient(a.app)
    for intent in ['route','electric']:
        monkeypatch.setattr(a.llm_client.chat.completions,'create',lambda **kwargs:SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps({'intent':intent})))]))
        if intent=='route':
            result=c.post('/chat_llm',params={'query':'请安排一下'},json=ROUTE).json()
            assert result['success'] and result['route_data']['solver']=='OR-Tools'
        else:
            async def reply(steps): return {'answer':'中风险1台','success':True}
            monkeypatch.setattr(a,'electrical_reply',reply)
            assert c.post('/chat_llm',params={'query':'箱子状况如何'}).json()['answer']=='中风险1台'


def test_websocket_relays_same_observations(modules,monkeypatch):
    e, g, a = modules
    original_client=httpx.AsyncClient

    class Transport(httpx.AsyncBaseTransport):
        async def handle_async_request(self,request):
            app=e.app if request.url.port==8001 else g.app
            return await httpx.ASGITransport(app=app).handle_async_request(request)

    monkeypatch.setattr(a.httpx,'AsyncClient',lambda **kwargs:original_client(transport=Transport(),**kwargs))
    with TestClient(a.app).websocket_connect('/ws/data') as ws:
        data=ws.receive_json()
        assert data['snapshot_id']==e.get_devices()['snapshot_id']
        assert data['device_updates']==e.get_devices()['devices']
        assert data['person_updates']==g.get_people()['people']
