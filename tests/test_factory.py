import json
import time
from datetime import datetime, timedelta, timezone
import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from gis.factory import FactoryStore, Observation, Batch, DemoCommand
from gis.factory import install_factory
from fastapi import FastAPI
from fastapi.testclient import TestClient
from common.runtime import configure_api


@pytest.fixture
def store(tmp_path):
    return FactoryStore(tmp_path/'factory.db')


def observe(store, **kwargs):
    return store.observe(Batch(observations=[Observation(**kwargs)]))


def test_shared_catalogue_and_read_only_snapshot(store):
    data=store.snapshot()
    assert len([e for e in data['entities'] if e['kind']=='device'])==30
    assert len([e for e in data['entities'] if e['kind']=='person'])==26
    assert len([e for e in data['entities'] if e['kind']=='zone'])==12
    assert len(data['active'])==6
    assert store.snapshot()==data
    saved=FactoryStore(store.path).snapshot()
    assert saved['revision']>data['revision']
    assert len(saved['active'])==6


def test_layout_migration_updates_demo_positions_but_preserves_telemetry(store):
    import sqlite3
    from gis.factory import CATALOG
    observe(store, id='P014', x=-30, z=-15)
    observe(store, id='B-03', measurements={'pressure':{'value':.62,'unit':'MPa'}})
    store.data['catalogRevision']=1
    next(e for e in store.data['entities'] if e['id']=='P020')['anchor']=[17,2.7,11]
    next(e for e in store.data['entities'] if e['id']=='Z005')['center']=[-12.5,-9]
    with sqlite3.connect(store.path) as db:
        db.execute('UPDATE factory_state SET payload=? WHERE id=1', (json.dumps(store.data),))
    migrated=FactoryStore(store.path).snapshot()
    by_id={e['id']:e for e in migrated['entities']}
    canonical={e['id']:e for e in CATALOG['entities']}
    assert migrated['catalogRevision']==CATALOG['catalogRevision']
    assert by_id['P014']['anchor'][::2]==[-30,-15]
    assert by_id['P014']['positionSource']=='telemetry'
    assert by_id['P020']['anchor']==canonical['P020']['anchor']
    assert by_id['Z005']['center']==canonical['Z005']['center']
    assert by_id['B-03']['measurements']['pressure']['value']==.62


def test_position_entry_exit_and_telemetry_not_overwritten(store):
    data=observe(store,id='P023',x=-28,z=23)
    assert any(a['entityId']=='P023' and a['zoneId']=='Z001' for a in data['active'])
    count=len(data['events']);store.tick()
    assert len(store.snapshot()['events'])==count
    record=next(e for e in store.snapshot()['entities'] if e['id']=='P023')
    assert record['positionSource']=='telemetry'
    assert record['anchor'][::2]==[-28,23]
    with pytest.raises(HTTPException) as error:
        store.command(DemoCommand(action='start',key='overview'))
    assert error.value.status_code==409
    store.command(DemoCommand(action='reset'))
    assert next(e for e in store.snapshot()['entities'] if e['id']=='P023')['anchor'][::2]==[-28,23]
    data=observe(store,id='P023',x=-41,z=12)
    assert not any(a['entityId']=='P023' for a in data['active'])
    assert data['events'][0]['type']=='leave'


def test_new_power_process_equipment_has_pressure_telemetry_and_live_entry(store):
    by_id={e['id']:e for e in store.snapshot()['entities']}
    for device_id in ['B-08','B-10','B-11']:
        assert by_id[device_id]['measurements']['pressure']['unit']=='MPa'
        assert by_id[device_id]['measurementSource']=='demo'
    data=observe(store,id='P016',x=5,z=-7)
    assert any(a['entityId']=='P016' and a['zoneId']=='Z010' for a in data['active'])
    data=observe(store,id='P016',x=-2,z=-.6)
    assert not any(a['entityId']=='P016' for a in data['active'])


def test_measurement_source_persistence_and_atomic_batch(store):
    data=observe(store,id='B-03',measurements={'pressure':{'value':.62,'unit':'MPa'}})
    store.tick()
    device=next(e for e in store.snapshot()['entities'] if e['id']=='B-03')
    assert device['measurementSource']=='telemetry'
    assert device['measurements']['pressure']['value']==.62
    restarted=FactoryStore(store.path)
    assert next(e for e in restarted.snapshot()['entities'] if e['id']=='B-03')['measurementSource']=='telemetry'
    before=store.snapshot()
    with pytest.raises(HTTPException):
        store.observe(Batch(observations=[Observation(id='P001',x=8,z=8),Observation(id='bad',x=1,z=1)]))
    assert before==store.snapshot()


def test_stale_position_does_not_resolve_existing_alarm(store):
    observe(store,id='P023',x=-28,z=23)
    e=next(e for e in store.data['entities'] if e['id']=='P023')
    e['positionTimestamp']=(datetime.now(timezone.utc)-timedelta(seconds=121)).isoformat()
    store.tick()
    assert e['riskState']=='unknown'
    assert e['currentZones']==['Z001']
    assert any(a['entityId']=='P023' and a['state']=='unknown' for a in store.snapshot()['active'])
    assert not any(r['entityId']=='P023' and r['type']=='leave' for r in store.snapshot()['events'])


@pytest.mark.parametrize('payload',[{'id':'P001','x':1},{'id':'P001','x':float('nan'),'z':1},{'id':'B-03','measurements':{'pressure':{'value':.4,'unit':'Pa'}}},{'id':'P001'}])
def test_invalid_observation_contract(payload):
    with pytest.raises(ValidationError):
        Observation(**payload)


def test_factory_http_subscription_and_lifespan(tmp_path,monkeypatch):
    monkeypatch.setenv('FACTORY_DB_PATH',str(tmp_path/'api.db'))
    app=FastAPI();configure_api(app);install_factory(app)
    with TestClient(app) as client:
        first=client.get('/factory/state').json()
        time.sleep(1.1)
        latest=client.get('/factory/state').json()
        assert latest['revision']>first['revision']
        response=client.post('/factory/observations',json={'observations':[{'id':'P023','x':-28,'z':23}]})
        assert response.status_code==200
        assert any(a['entityId']=='P023' for a in response.json()['active'])
        assert client.post('/factory/demo',json={'action':'start','key':'overview'}).status_code==409
        assert client.post('/factory/observations',json={'observations':[{'id':'P023','x':1}]}).status_code==422


def test_factory_origin_guard(tmp_path,monkeypatch):
    monkeypatch.setenv('FACTORY_DB_PATH',str(tmp_path/'guard.db'))
    app=FastAPI();configure_api(app);install_factory(app)
    with TestClient(app) as client:
        blocked=client.post('/factory/demo',json={'action':'start'},headers={'Origin':'https://unrelated.example'})
        assert blocked.status_code==403
