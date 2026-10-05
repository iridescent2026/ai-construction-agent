from fastapi.testclient import TestClient
from test_p0 import modules

def test_motion_is_labeled_and_moves_without_overwriting_real_people(modules):
    _,g,_=modules
    c=TestClient(g.app)
    c.post('/check_danger',json={'person_id':'REAL-1','lng':120.01,'lat':30.29})
    a=c.post('/simulation/motion',json={'mode':'phone','step':0}).json()
    b=c.post('/simulation/motion',json={'mode':'phone','step':10}).json()
    assert a['simulated'] is True
    first=next(p for p in a['state']['people'] if p['person_id']=='SIM-GPS-1')
    second=next(p for p in b['state']['people'] if p['person_id']=='SIM-GPS-1')
    assert first['lng']!=second['lng'] and second['source']=='simulation_phone'
    assert next(p for p in b['state']['people'] if p['person_id']=='REAL-1')['lng']==120.01
    result=c.post('/simulation/motion',json={'mode':'camera','step':2}).json()
    assert len([p for p in result['state']['people'] if p['source']=='simulation_camera'])==2

def test_motion_protects_real_identity_and_production_mode(modules,monkeypatch):
    _,g,_=modules
    c=TestClient(g.app)
    c.post('/check_danger',json={'person_id':'SIM-GPS-1','lng':121,'lat':31})
    assert c.post('/simulation/motion',json={'mode':'phone','step':0}).status_code==409
    monkeypatch.setenv('DEMO_MODE','0')
    assert c.post('/simulation/motion',json={'mode':'camera','step':0}).status_code==403

def test_motion_rejects_bad_mode_or_step(modules):
    c=TestClient(modules[1].app)
    for body in [{'mode':'real','step':0},{'mode':'phone','step':-1}]:
        assert c.post('/simulation/motion',json=body).status_code==422
