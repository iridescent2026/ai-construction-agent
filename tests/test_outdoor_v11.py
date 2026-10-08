from datetime import datetime, timedelta, timezone
import time
import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from gis.factory import FactoryStore, Observation, Batch, DemoCommand, REFERENCE

def test_three_workers_move_and_telemetry_stops_group_without_overwrite(tmp_path):
    store=FactoryStore(tmp_path/'group.db')
    before={e['id']:e['anchor'][:] for e in store.snapshot()['entities']}
    result=store.command(DemoCommand(action='start',key='outdoor'))
    assert result['demo']['ids']==['P023','P024','P021']
    store.data['demo']['started']=time.monotonic()-9
    store.tick()
    data=store.snapshot()
    for person in ['P023','P024','P021']:
        assert next(e for e in data['entities'] if e['id']==person)['anchor']!=before[person]
    assert any(a['view']=='overview' for a in data['active'])
    store.observe(Batch(observations=[Observation(id='P024',x=70,z=55)]))
    assert store.snapshot()['demo'] is None
    store.tick()
    assert next(e for e in store.snapshot()['entities'] if e['id']=='P024')['anchor'][::2]==[70,55]
    with pytest.raises(HTTPException):store.command(DemoCommand(action='start',key='outdoor'))

def test_old_capture_remains_unknown_and_late_batch_is_atomic(tmp_path):
    store=FactoryStore(tmp_path/'capture.db')
    captured=datetime.now(timezone.utc)-timedelta(seconds=140)
    result=store.observe(Batch(observations=[Observation(id='P023',x=-28,z=23,observedAt=captured)]))
    person=next(e for e in result['entities'] if e['id']=='P023')
    assert person['riskState']=='unknown'
    assert datetime.fromisoformat(person['positionTimestamp'])==captured
    before=store.snapshot()
    with pytest.raises(HTTPException) as error:
        store.observe(Batch(observations=[Observation(id='P021',x=8,z=40),Observation(id='P023',x=-28,z=23,observedAt=captured-timedelta(seconds=1))]))
    assert error.value.status_code==409
    assert store.snapshot()==before

@pytest.mark.parametrize('value',[datetime.now(),datetime.now(timezone.utc)+timedelta(days=1)])
def test_capture_rejects_naive_or_future(value):
    with pytest.raises(ValidationError):Observation(id='P023',x=0,z=0,observedAt=value)

def test_scene_and_backend_share_origin_scale_rotation(tmp_path):
    data=FactoryStore(tmp_path/'coords.db').snapshot()['coordinateSystem']
    assert data['origin']==REFERENCE['origin']
    for key,frame in REFERENCE['frames'].items():
        assert data['frames'][key]==[*frame['translation'],frame['scale']]
        assert data['rotations'][key]==frame['rotation']

def test_live_mode_cannot_fabricate_fresh_positions_or_restart_demo(tmp_path,monkeypatch):
    monkeypatch.setenv('DEMO_MODE','0')
    store=FactoryStore(tmp_path/'live.db')
    store.tick()
    people=[e for e in store.snapshot()['entities'] if e['kind']=='person']
    assert all(e['riskState']=='unknown' for e in people)
    with pytest.raises(HTTPException) as error:store.command(DemoCommand(action='start',key='outdoor'))
    assert error.value.status_code==403
    result=store.observe(Batch(observations=[Observation(id='P023',x=-28,z=23)]))
    assert any(a['entityId']=='P023' and a['state']=='danger' for a in result['active'])
