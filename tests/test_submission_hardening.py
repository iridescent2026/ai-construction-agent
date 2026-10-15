import hashlib
import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from common.database import connect
from gis.model_quota import ModelQuota, QuotaLimit
from gis.experiment_statistics import summarize
from gis.factory_workspaces import Workspaces
from gis.factory_analysis import AnalysisStore, Edge


@pytest.fixture(autouse=True)
def local_only(monkeypatch):
    monkeypatch.delenv('DATABASE_URL', raising=False)


def test_global_quota_atomic_across_instances_and_restart(tmp_path, monkeypatch):
    monkeypatch.setenv('WORKFLOW_MODEL_DAILY_LIMIT', '7')
    path=tmp_path/'quota.db'
    ModelQuota(path)
    def attempt(i):
        try:ModelQuota(path).acquire('space-'+str(i),now=86400*20+100);return True
        except QuotaLimit:return False
    with ThreadPoolExecutor(max_workers=8) as pool:results=list(pool.map(attempt,range(20)))
    assert sum(results)==7
    assert ModelQuota(path).status(now=86400*20+150)['remaining']==0
    ModelQuota(path).acquire('another',now=86400*21+100)
    assert ModelQuota(path).status(now=86400*21+150)['used']==1


def test_scope_minute_rate_and_failed_provider_consumes_attempt(tmp_path,monkeypatch):
    monkeypatch.setenv('WORKFLOW_TEMPLATE_FIRST','0')
    quota=ModelQuota(tmp_path/'quota.db')
    for _ in range(6):quota.acquire('one',now=1000)
    with pytest.raises(QuotaLimit):quota.acquire('one',now=1001)
    quota.acquire('one',now=1061)
    import gis.workflow_language as language
    monkeypatch.setenv('WORKFLOW_QUOTA_DB_PATH',str(tmp_path/'quota.db'))
    monkeypatch.setenv('WORKFLOW_MODEL_ENABLED','1')
    monkeypatch.setenv('WORKFLOW_MODEL_API_KEY','test-fixture-only')
    def unavailable(*args,**kwargs):raise RuntimeError('provider failed')
    monkeypatch.setattr(language.httpx,'post',unavailable)
    assert language.interpret('查询温度','B-05')['trace']['status']=='fallback'
    assert ModelQuota(tmp_path/'quota.db').status()['used']==1


def test_archive_releases_cap_and_undo_keeps_expiry_and_history(tmp_path):
    app=SimpleNamespace(state=SimpleNamespace(factory=SimpleNamespace(demo_enabled=True)))
    manager=Workspaces(app,tmp_path/'spaces.db');ids=[hashlib.sha256(str(i).encode()).hexdigest() for i in range(40)]
    expired=time.time()-100
    with connect(manager.path) as db:
        for id in ids:db.execute('INSERT INTO workspaces VALUES(?,?)',(id,expired))
    with pytest.raises(HTTPException) as full:manager.create()
    assert full.value.status_code==429
    receipt=manager.archive(ids[0],{'id':'project-admin'})
    assert manager.archive(ids[0],{'id':'other-admin'})['actor']==receipt['actor']
    assert Workspaces(app,manager.path).inventory()['retained']==39
    result=manager.archive(ids[0],{'id':'project-admin'},restore=True)
    assert result['expiresAt']==expired and manager.inventory()['retained']==40
    assert [r['action'] for r in manager.inventory()['history']]==['restore','archive']
    manager.archive(ids[0],{'id':'project-admin'});manager.create()
    with pytest.raises(HTTPException) as full:manager.archive(ids[0],{'id':'project-admin'},restore=True)
    assert full.value.status_code==409
    with connect(manager.path) as db:assert db.execute('SELECT expires FROM workspaces WHERE id=?',(ids[0],)).fetchone()[0]==expired


def test_cannot_archive_active_space(tmp_path):
    manager=Workspaces(SimpleNamespace(state=SimpleNamespace(factory=SimpleNamespace(demo_enabled=True))),tmp_path/'spaces.db')
    token=manager.create()['workspace'];id=hashlib.sha256(token.encode()).hexdigest()
    with pytest.raises(HTTPException) as error:manager.archive(id,{'id':'project-admin'})
    assert error.value.status_code==409 and not manager.inventory()['archived']


def test_wrong_unfinished_and_first_attempt_not_cherry_picked():
    def run(method,score,seconds,started,status='finished'):
        return {'owner':'human-1','method':method,'score':score,'durationSeconds':seconds,'startedAt':started,'task':{'id':'fresh_alert'},'status':status}
    result=summarize([run('manual',2,20,'a'),run('manual',4,50,'b'),run('system',4,10,'c'),run('system',0,None,'d','running')])
    assert result['methods']['manual']['incorrect']==1
    assert result['methods']['system']['unfinished']==1
    assert result['methods']['system']['completionRate']==.5
    assert result['methods']['manual']['medianCompletedSeconds']==35
    assert result['allCompletedPairs'][0]['manualScore']==2
    assert result['allCompletedPairs'][0]['savedSeconds']==10
    assert not result['correctPairs'] and result['medianCorrectPairsSavedSeconds'] is None
    assert not result['completeParticipants']


def test_unknown_direction_is_candidate_not_causal():
    class Context:
        impact_context=AnalysisStore.impact_context
    graph={'nodes':[{'id':id,'kind':'device'} for id in ('pump','cabinet','pipe','zone')],
           'edges':[Edge(source='cabinet',target='pump',relation='供电',relationKind='power',direction='forward').model_dump(),
                    Edge(source='pump',target='pipe',relation='出水',relationKind='fluid',direction='forward',condition='阀门开启').model_dump(),
                    Edge(source='pipe',target='zone',relation='区域未核验').model_dump()]}
    result=Context().impact_context('pump',{'revision':1,'entities':[]},graph,[])
    assert {n['id'] for n in result['nodes']}=={'pump','cabinet','pipe','zone'}
    assert result['directionalCandidates']==['pipe']
    assert any(e['direction']=='unknown' for e in result['relationEvidence'])
    assert result['hasUnverified'] and '不是故障传播仿真' in result['basis']
