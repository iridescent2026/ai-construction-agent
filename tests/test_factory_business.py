from datetime import datetime,timedelta,timezone
import pytest
from test_device_workflow import system,login,order_action
from gis.factory import Batch,Observation
from gis.factory_business import evaluate_registered

def date(offset):return (datetime.now(timezone.utc)+timedelta(seconds=offset)).isoformat()
def rule(metric='temperature',threshold=60,unit='℃'):
    return dict(entityId='B-05',metric=metric,unit=unit,operator='gte',threshold=threshold,
                effectiveFrom=date(-60),effectiveUntil=date(86400),purpose='software_test',
                reference='原型测试依据 V20，非工程阈值',response='核对读数和设备文件，由现场责任人核查。')
def proposal(client,value,headers):
    result=client.post('/factory/business/rules',json=value,headers=headers);assert result.status_code==200,result.text
    return result.json()
def review(client,row,headers,kind='rule',decision='approve'):
    return client.post('/factory/business/review/'+kind+'/'+row['id'],headers=headers,json={
        'expectedVersion':row['version'],'decision':decision,'qualification':'原型复核岗位，非工程资质认证',
        'note':'只核对软件测试依据，不构成真实现场规则确认。'})
def plan(id='MR-B05',start=600,end=1200,center=(-10,17),view='b'):
    return dict(id=id,title='原型检修核查',view=view,startsAt=date(start),endsAt=date(end),
                center=list(center),size=[4,4],kind='检修核查',source='manual')

def test_rule_permissions_scope_and_single_alert_not_diluted(system):
    app,client=system;safety=login(client,'safety');reviewer=login(client,'reviewer');observer=login(client,'observer')
    assert client.post('/factory/business/rules',json=rule(),headers=observer).status_code==403
    assert client.post('/factory/business/rules',json=rule(unit='K'),headers=safety).status_code==422
    assert client.post('/factory/business/rules',json=rule(metric='flow',unit='m³/h'),headers=safety).status_code==422
    hot=proposal(client,rule(),safety)
    assert review(client,hot,safety).status_code==403
    assert app.state.factory_workflow.case()['observation']['status']=='pending'
    hot=review(client,hot,reviewer).json();assert hot['status']=='prototype_reviewed'
    assert review(client,dict(hot,version=1),reviewer).status_code==409
    pressure=proposal(client,rule('pressure',.8,'MPa'),safety)
    assert review(client,pressure,reviewer).status_code==200
    app.state.factory.observe(Batch(observations=[Observation(id='B-05',measurements={'temperature':{'value':70,'unit':'℃'},'pressure':{'value':.5,'unit':'MPa'}})]))
    case=app.state.factory_workflow.case(use_test=True)
    assert case['observation']['status']=='registered_alert'
    assert [c['result'] for c in case['observation']['ruleChecks']]==['triggered','not_triggered']
    assert app.state.factory_workflow.case()['observation']['status']=='pending'
    assert review(client,hot,reviewer,decision='reject').json()['status']=='rejected'
    assert app.state.factory_workflow.case(use_test=True)['observation']['status']=='registered_clear'
    entity={'id':'B-05','measurements':{'temperature':{'value':70,'unit':'℃'}}}
    rules=[dict(rule(),id='r1',version=2,status='prototype_reviewed',reviewer='r'),
           dict(rule('pressure',.8,'MPa'),id='r2',version=2,status='prototype_reviewed',reviewer='r')]
    assert evaluate_registered(entity,rules,True,True,datetime.now(timezone.utc).timestamp())['status']=='registered_alert'
    assert evaluate_registered(entity,rules,False,True,datetime.now(timezone.utc).timestamp())['status']=='unknown'
    for r in rules:r['effectiveUntil']=date(-1)
    assert evaluate_registered(entity,rules,True,True,datetime.now(timezone.utc).timestamp()) is None

def test_scenario_review_changed_rules_invalidate_draft_and_recommendations_have_basis(system):
    app,client=system;safety=login(client,'safety');reviewer=login(client,'reviewer')
    assert client.get('/factory/business').json()['scenario']['status']=='design_assumption'
    body={'expectedVersion':1,'title':'模块化生产辅助排水核查','description':'辅助排水、人员与作业计划的业务假设，待工程核验。','reference':'学生原型场景草案 V20，待工程老师核验'}
    row=client.post('/factory/business/scenario',json=body,headers=safety).json()
    assert row['status']=='submitted'
    assert client.post('/factory/business/scenario',json=body,headers=safety).status_code==409
    assert review(client,row,reviewer,kind='scenario').json()['status']=='prototype_reviewed'
    draft=client.post('/factory/workflow/drafts',json={},headers=safety).json()
    proposal(client,rule(),safety)
    assert client.post('/factory/workflow/drafts/'+draft['id']+'/confirm',json={'assignee':'demo-maintenance'},headers=safety).status_code==409
    assert '确认处置边界' in [r['step'] for r in app.state.factory_workflow.case()['recommendations']]
    assert '核对' in client.post('/factory/workflow/chat',json={'query':'B-05 处置建议'}).json()['answer']
    assert '没有已录入工单' in client.post('/factory/workflow/chat',json={'query':'B-05 谁负责处理'}).json()['answer']
    graph=client.get('/factory/analysis').json()['graph']
    for edge in graph['edges']:edge.update(verified=True,reference='原型连接复核，尚无真实图纸',reviewer='spoof',reviewScope='recorded')
    assert client.post('/factory/analysis/graph',json=graph,headers=reviewer).status_code==200
    impact=client.get('/factory/analysis/impact/B-05').json()
    assert impact['hasUnverified']
    assert all(e['reviewer']=='demo-reviewer' and e['reviewScope']=='prototype' for e in impact['edges'])

def test_maintenance_conflict_blocks_confirm_and_later_conflict_blocks_start(system):
    app,client=system;safety=login(client,'safety');maintenance=login(client,'maintenance')
    client.post('/factory/analysis/plans',json={'plans':[plan('LIFT',500,1500)]},headers=safety)
    candidate=plan()
    check=client.post('/factory/business/maintenance/check',json={'entityId':'B-05','plan':candidate}).json()
    assert check['blocked'] and check['conflicts'][0]['overlapAreaM2']==16
    draft=client.post('/factory/workflow/drafts',json={'maintenancePlan':candidate},headers=safety).json()
    assert draft['case']['maintenanceCheck']['blocked']
    assert client.post('/factory/workflow/drafts/'+draft['id']+'/confirm',json={'assignee':'demo-maintenance'},headers=safety).status_code==409
    assert not client.get('/factory/analysis').json()['orders']
    assert client.post('/factory/business/maintenance/check',json={'plan':plan(view='a')}).status_code==422
    assert client.post('/factory/business/maintenance/check',json={'plan':plan(center=(90,90))}).status_code==422
    candidate=plan(start=-60,end=300)
    draft=client.post('/factory/workflow/drafts',json={'maintenancePlan':candidate},headers=safety).json()
    created=client.post('/factory/workflow/drafts/'+draft['id']+'/confirm',json={'assignee':'demo-maintenance'},headers=safety)
    assert created.status_code==200,created.text
    order=created.json()['order']
    assert len(client.get('/factory/analysis').json()['plans'])==2
    assert order['trigger']['workflowCase']['maintenancePlan']['id']=='MR-B05'
    client.post('/factory/analysis/plans',json={'plans':[candidate,plan('NEW-LIFT',-60,300)]},headers=safety)
    assert order_action(client,order,'start',maintenance).status_code==409
    client.post('/factory/analysis/plans',json={'plans':[]},headers=safety)
    assert order_action(client,order,'start',maintenance).status_code==409
    client.post('/factory/analysis/plans',json={'plans':[candidate]},headers=safety)
    assert order_action(client,order,'start',maintenance).status_code==200

def test_experiment_clock_accuracy_pairing_and_ownership_no_fabricated_benefit(system):
    app,client=system;safety=login(client,'safety');observer=login(client,'observer')
    assert client.get('/factory/business/experiment/report',headers=safety).json()['medianSavedSeconds'] is None
    assert client.post('/factory/business/experiment/runs',json={'taskId':'fresh_alert','method':'manual'}).status_code==401
    answer={'observation':'triggered','candidateIds':['Z007','B-01','PIPE-B-05'],'unknownPeople':1,'decision':'check'}
    for method in ['manual','system']:
        row=client.post('/factory/business/experiment/runs',json={'taskId':'fresh_alert','method':method},headers=safety).json()
        assist='/factory/business/experiment/runs/'+row['id']+'/assist'
        assert client.post(assist,json={},headers=observer).status_code==403
        result=client.post(assist,json={},headers=safety)
        assert result.status_code==(403 if method=='manual' else 200)
        if method=='system':assert len(result.json()['tools'])==3
        finish='/factory/business/experiment/runs/'+row['id']+'/finish'
        result=client.post(finish,json=answer,headers=safety)
        assert result.status_code==200,result.text
        assert result.json()['score']==4 and result.json()['durationSeconds']>=0
        assert client.post(finish,json=answer,headers=safety).status_code==409
    report=client.get('/factory/business/experiment/report',headers=safety).json()
    assert report['finished']==2 and len(report['pairedTasks'])==1
    assert not client.get('/factory/business/experiment/report',headers=observer).json()['runs']
    for key in ['stale','missing','no_trigger']:
        row=client.post('/factory/business/experiment/runs',json={'taskId':key,'method':'system'},headers=safety).json()
        finish='/factory/business/experiment/runs/'+row['id']+'/finish'
        assert client.post(finish,json=answer,headers=safety).status_code==409
        solved=client.post('/factory/business/experiment/runs/'+row['id']+'/assist',json={},headers=safety).json()
        assert solved['answer']['observation']==('not_triggered' if key=='no_trigger' else 'unknown')
        assert client.post(finish,json=dict(solved['answer'],unknownPeople=0),headers=safety).json()['score']==3
    assert len(client.get('/factory/business/experiment/report',headers=safety).json()['pairedTasks'])==1
