from datetime import datetime,timezone,timedelta
import copy
import sqlite3
import base64
import pytest
from fastapi import FastAPI,HTTPException
from fastapi.testclient import TestClient
from gis.factory import FactoryStore,Batch,Observation,install_factory
from gis.factory_analysis import AnalysisStore,Graph,Plans,WorkPlan,OrderCreate,OrderAction,Meters,energy_summary,conflicts,Edge,seconds


@pytest.fixture
def analysis(tmp_path):
    factory=FactoryStore(tmp_path/'factory.db')
    return AnalysisStore(tmp_path/'analysis.db',factory)


def date(offset=0):
    return (datetime.now(timezone.utc)+timedelta(seconds=offset)).isoformat()


def plan(id,center,size=(10,10),view='overview',start=0,end=60):
    return WorkPlan(id=id,title=id,view=view,center=list(center),size=list(size),startsAt=date(start),endsAt=date(end)).model_dump(mode='json')


def test_conflict_checks_containment_time_and_separate_coordinate_frames():
    outer=plan('outer',(0,0),(100,100));inner=plan('inner',(0,0),(4,3));other=plan('other',(0,0),(4,3),'a')
    result=conflicts([outer,inner,other]);assert len(result)==1;assert result[0]['overlapAreaM2']==12
    assert not conflicts([outer,plan('later',(0,0),start=100,end=160)])
    assert not conflicts([plan('left',(0,0)),plan('edge',(10,0))])


def test_impact_cycle_is_bounded_and_unverified_links_remain_explicit(analysis):
    result=analysis.impact('B-05')
    assert result['hasUnverified'];assert {'B-05','B-01','PIPE-B-05','Z007'}<=set(n['id'] for n in result['nodes'])
    graph=analysis.summary()['graph'];graph['edges'].append({'source':'Z007','target':'B-01','relation':'test','verified':False})
    analysis.graph(Graph(**graph));result=analysis.impact('B-05')
    assert len(result['nodes'])==4;assert len(result['edges'])==4
    assert all(p['riskState']!='unknown' for p in result['people'])
    with pytest.raises(ValueError):Edge(source='B-05',target='B-01',relation='供电',verified=True)


def create(analysis):
    return analysis.create_order(OrderCreate(entityId='B-05',reason='复核泵组观测',actor='安全员'))


def act(analysis,o,action,actor='维修员',**extra):
    return analysis.action(o['id'],OrderAction(action=action,expectedVersion=o['version'],actor=actor,**extra))


def test_order_full_loop_rejects_stale_version_missing_evidence_and_self_review(analysis):
    order=create(analysis);order=act(analysis,order,'assign','安全员',assignee='维修员')
    with pytest.raises(HTTPException):analysis.action(order['id'],OrderAction(action='start',expectedVersion=1,actor='维修员'))
    with pytest.raises(HTTPException):act(analysis,order,'start','其他人')
    order=act(analysis,order,'start')
    with pytest.raises(HTTPException):act(analysis,order,'complete')
    order=act(analysis,order,'complete',note='已检查接头并上传巡检记录')
    with pytest.raises(HTTPException):act(analysis,order,'approve',note='自审')
    order=act(analysis,order,'reject','复核员',note='请补充压力复测')
    assert order['status']=='in_progress'
    order=act(analysis,order,'complete',note='压力复测记录已补充')
    order=act(analysis,order,'approve','复核员',note='现场核验完成')
    assert order['status']=='closed';assert analysis.summary()['meanClosureSeconds'] is not None
    order=act(analysis,order,'reopen','安全员',note='同处再次发现异常')
    assert order['status']=='assigned';assert analysis.summary()['meanClosureSeconds'] is None
    reloaded=AnalysisStore(analysis.path,analysis.factory)
    assert reloaded.summary()['orders'][0]['version']==order['version']


def test_failed_order_commit_never_changes_persisted_state(analysis,monkeypatch):
    order=create(analysis)
    def fail(*args):raise sqlite3.OperationalError('write failure')
    monkeypatch.setattr(analysis,'put',fail)
    with pytest.raises(sqlite3.Error):act(analysis,order,'assign','安全员',assignee='维修员')
    assert analysis.summary()['orders'][0]['status']=='open'
    assert analysis.summary()['orders'][0]['version']==1


def test_photo_evidence_is_validated_persisted_and_not_repeated_in_polling(analysis):
    with pytest.raises(ValueError):
        OrderAction(action='complete',expectedVersion=1,actor='维修员',note='凭证',image='data:image/svg+xml;base64,AAAA')
    order=act(analysis,create(analysis),'assign','安全员',assignee='维修员')
    order=act(analysis,order,'start')
    image='data:image/png;base64,'+base64.b64encode(b'\x89PNG\r\n\x1a\n'+b'test-content').decode()
    order=act(analysis,order,'complete',note='附照片记录',image=image)
    metadata=analysis.summary()['orders'][0]['evidence']
    assert metadata['imageAvailable'] and 'image' not in metadata
    assert analysis.order_image(order['id'])['image']==image
    assert AnalysisStore(analysis.path,analysis.factory).order_image(order['id'])['image']==image


def meter(id,offset,power=6,source='telemetry',shift='白班',running=False):
    return dict(id=id,deviceId='B-05',observedAt=date(offset),powerKW=power,source=source,shift=shift,running=running)


def test_energy_units_gaps_sources_and_shift_transitions():
    now=datetime.now(timezone.utc)
    def row(id,dt,source='telemetry',shift='白班'):
        return {**meter(id,dt,source=source,shift=shift),'observedAt':(now+timedelta(seconds=dt)).isoformat()}
    rows=[row('1',-60),row('2',0),row('3',-60,'demo'),row('4',0,'demo')]
    result=energy_summary(rows,now);assert len(result)==2
    assert all(r['estimatedKWh']==.1 and r['idleEstimatedKWh']==.1 for r in result)
    assert energy_summary([row('a',-300),row('b',0)],now)[0]['estimatedKWh'] is None
    result=energy_summary([row('a',-60),row('b',-30,shift='夜班'),row('c',0)],now)
    assert all(r['estimatedKWh'] is None for r in result)
    unknown=[{**row('u',-60),'running':None},{**row('v',0),'running':None}]
    idle=energy_summary(unknown,now)[0]
    assert idle['estimatedKWh']==.1 and idle['idleEstimatedKWh'] is None
    assert idle['idleUnknownSeconds']==60
    separate=[{**row('s1',-60,source='demo'),'streamId':'live-demo'},{**row('s2',0,source='demo'),'streamId':'live-demo'},
        {**row('s3',-30,source='demo'),'streamId':'manual-demo'},{**row('s4',0,source='demo'),'streamId':'manual-demo'}]
    channels=energy_summary(separate,now)
    assert len(channels)==2
    assert {r['streamId']:r['estimatedKWh'] for r in channels}=={'live-demo':.1,'manual-demo':.05}


def test_meter_idempotency_capture_duplicates_atomic_batch_and_real_mode(analysis):
    values=Meters(readings=[meter('m1',-60),meter('m2',0)])
    analysis.meters(values);analysis.meters(values)
    assert analysis.summary()['energy'][0]['samples']==2
    changed=values.model_dump();changed['readings'][0]['powerKW']=99
    with pytest.raises(HTTPException):analysis.meters(Meters(**changed))
    same_capture=values.readings[0].model_dump();same_capture['id']='different-id'
    with pytest.raises(HTTPException):analysis.meters(Meters(readings=[same_capture]))
    with pytest.raises(HTTPException):analysis.meters(Meters(readings=[meter('valid',-10),{**meter('invalid',-5),'deviceId':'MISSING'}]))
    assert analysis.summary()['energy'][0]['samples']==2
    analysis.factory.demo_enabled=False
    with pytest.raises(HTTPException):analysis.meters(Meters(readings=[meter('demo',-1,source='demo')]))


def test_replay_recording_keeps_unknown_gaps_and_deduplicates_revisions(analysis):
    frame=analysis.factory.snapshot();now=datetime.now(timezone.utc)
    person=next(e for e in frame['entities'] if e['id']=='P023')
    for i,(dt,zones,state) in enumerate([(0,[],'clear'),(1,['Z001'],'danger'),(2,['Z001'],'danger'),(3,['Z001'],'unknown'),(20,['Z001'],'danger')]):
        frame['revision']=i;frame['updatedAt']=(now+timedelta(seconds=dt)).isoformat()
        person.update(currentZones=zones,riskState=state,positionTimestamp=frame['updatedAt'],positionSource='demo')
        analysis.record(frame)
    analysis.record(frame)
    assert len(analysis.replay())==5
    result=analysis.exposure();row=next(e for e in result['items'] if e['entityId']=='P023')
    assert row['exposureSeconds']==1;assert row['enterEvents']==1;assert row['unknownSeconds']==1
    assert result['recordingGapSeconds']==17
    assert analysis.frame(analysis.replay()[0]['id'])['entities'][0]['id']


def test_analysis_http_routes_and_validation(tmp_path,monkeypatch):
    monkeypatch.setenv('FACTORY_DB_PATH',str(tmp_path/'factory-http.db'))
    app=FastAPI();install_factory(app)
    with TestClient(app) as client:
        assert client.get('/factory/analysis').status_code==200
        assert client.get('/factory/analysis/impact/B-05').json()['hasUnverified']
        assert client.post('/factory/analysis/plans',json={'plans':[]}).status_code==200
        assert client.post('/factory/analysis/graph',json={'nodes':[],'edges':[{'source':'x','target':'y','relation':'test'}]}).status_code==422
        created=client.post('/factory/analysis/orders',json={'entityId':'B-05','reason':'HTTP复核','actor':'安全员'})
        assert created.status_code==200
        order=created.json()
        assert client.post('/factory/analysis/orders/'+order['id'],json={'action':'assign','expectedVersion':1,'actor':'安全员','assignee':'维修员'}).status_code==200
        assert client.post('/factory/analysis/meters',json={'readings':[meter('http1',-60),meter('http2',0)]}).status_code==200
        assert client.get('/factory/analysis/replay').json()


def test_observation_measurement_retains_capture_time(analysis):
    observed=date(-300)
    data=analysis.factory.observe(Batch(observations=[Observation(id='B-05',observedAt=observed,measurements={'temperature':{'value':70,'unit':'℃'}})]))
    item=next(e for e in data['entities'] if e['id']=='B-05')
    assert seconds(item['measurementTimestamp'])==seconds(observed)
