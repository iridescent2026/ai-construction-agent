from datetime import datetime,timezone,timedelta
import pytest
from fastapi import FastAPI,HTTPException
from fastapi.testclient import TestClient
from gis.factory import FactoryStore,Batch,Observation,DemoCommand,install_factory
from gis.factory_analysis import AnalysisStore,Plans,OrderCreate
from gis.factory_demo_feed import DemoFeed


@pytest.fixture
def feed(tmp_path):
    factory=FactoryStore(tmp_path/'factory.db');analysis=AnalysisStore(tmp_path/'analysis.db',factory)
    result=DemoFeed(factory,analysis);analysis.demo_feed=result;return result


def test_feed_seeds_all_five_functions_keeps_orders_manual_and_stop_freezes_meters(feed):
    now=datetime.now(timezone.utc)-timedelta(seconds=10)
    started=feed.start(now);assert started['running'] and started['samplesThisRun']==3
    data=feed.factory.snapshot();assert data['demo']['key']=='outdoor'
    pump=next(e for e in data['entities'] if e['id']=='B-05')
    assert pump['measurementSource']=='demo' and pump['measurements']['temperature']['value']>=58
    summary=feed.analysis.summary();assert len(summary['energy'])==3 and summary['conflicts']
    assert all(e['estimatedKWh'] is not None for e in summary['energy'])
    assert summary['orders'][0]['status']=='assigned' and summary['orders'][0]['source']=='demo'
    assert feed.analysis.impact('B-05')['orders'] and feed.analysis.replay()
    feed.tick(now+timedelta(seconds=5));assert feed.samples==4
    feed.stop();feed.tick();assert feed.samples==4
    assert feed.factory.snapshot()['demo'] is None
    assert feed.analysis.summary()['orders'][0]['status']=='assigned'


def test_feed_is_idempotent_preserves_manual_configuration_and_does_not_override_telemetry(feed):
    now=datetime.now(timezone.utc)
    feed.factory.observe(Batch(observations=[Observation(id='P023',x=-10,z=10),Observation(id='B-05',measurements={'temperature':{'value':40,'unit':'℃'}})]))
    manual={'id':'DEMO-FEED-LIFT','title':'人工计划','view':'a','center':[0,0],'size':[3,3],'startsAt':now.isoformat(),'endsAt':(now+timedelta(hours=1)).isoformat(),'source':'manual'}
    feed.analysis.plans(Plans(plans=[manual]));existing=feed.analysis.create_order(OrderCreate(entityId='B-01',reason='人工待检',actor='真人'))
    feed.start();feed.start()
    data=feed.factory.snapshot();assert data['demo'] is None
    assert next(e for e in data['entities'] if e['id']=='P023')['anchor'][0]==-10
    pump=next(e for e in data['entities'] if e['id']=='B-05');assert pump['measurements']['temperature']['value']==40
    summary=feed.analysis.summary();assert summary['plans'][0]['title']=='人工计划'
    assert len(summary['orders'])==1 and summary['orders'][0]['id']==existing['id']
    assert len(summary['energy'])==2 and not any(r['deviceId']=='B-05' for r in summary['energy'])


def test_stopping_feed_does_not_stop_other_user_motion(feed):
    feed.factory.command(DemoCommand(action='start',key='a'))
    feed.start();feed.stop();assert feed.factory.snapshot()['demo']['key']=='a'


def test_real_mode_rejects_feed_and_demo_orders(feed):
    feed.factory.demo_enabled=False
    with pytest.raises(HTTPException):feed.start()
    with pytest.raises(HTTPException):feed.analysis.create_order(OrderCreate(entityId='B-05',reason='演示',actor='模拟',source='demo'))


def test_autostart_routes_and_two_clients_share_one_stream(tmp_path,monkeypatch):
    monkeypatch.setenv('FACTORY_DB_PATH',str(tmp_path/'http.db'));monkeypatch.setenv('FACTORY_ANALYSIS_DEMO','1')
    app=FastAPI();install_factory(app)
    with TestClient(app) as client:
        first=client.get('/factory/analysis').json();assert first['demoFeed']['running']
        again=client.post('/factory/analysis/demo-feed',json={'action':'start'}).json()
        assert again['startedAt']==first['demoFeed']['startedAt']
        assert client.post('/factory/analysis/demo-feed',json={'action':'stop'}).status_code==200
        assert not client.get('/factory/analysis').json()['demoFeed']['running']
