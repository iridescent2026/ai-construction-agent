"""新版观测/快照契约下的综合风险迁移验收。"""
from datetime import datetime, timezone, timedelta
import unittest
from unittest.mock import patch
import httpx
from fastapi.testclient import TestClient
from agent_support import agent


def level(score):
    return '高' if score >= .7 else '中' if score >= .3 else '低'


def device(score=.8):
    return {'device_id':'D1','device_type':'配电箱','timestamp':datetime.now(timezone.utc).isoformat(),
            'status':'online','load':20,'temperature':25,'leakage':0,'risk_score':score,
            'risk_level':level(score),'alert':'正常' if score < .3 else '风险告警'}


def spatial(score=.4):
    return {'revision':3,'unknown_people':0,'people':[{'person_id':'P1'}],
            'results':[{'person_id':'P1','risk_level':level(score)}],
            'heatmap':[{'zone_id':'Z1','zone_type':'基坑','risk_level':level(score),'people_count':1,'risk_score':score}]}


class UpstreamFixture:
    def setUp(self):
        self.client=TestClient(agent.app)
        self.spatial=spatial()
        self.electrical={'snapshot_id':4,'devices':[device()]}
        self.fail=False

    def request(self,path='/risk'):
        original=httpx.AsyncClient
        def transport(request):
            if self.fail:return httpx.Response(503,json={'detail':'test unavailable'})
            return httpx.Response(200,json=self.spatial if request.url.path=='/state' else self.electrical)
        with patch.object(agent.httpx,'AsyncClient',side_effect=lambda *a,**kw:original(transport=httpx.MockTransport(transport),*a,**kw)):
            return self.client.get(path)


class RiskTests(UpstreamFixture, unittest.TestCase):
    def test_fusion_keeps_latest_contract_and_highest_score(self):
        result=self.request().json()
        self.assertEqual(result['overall_risk'],.8)
        self.assertEqual(result['snapshot_id'],4)
        self.assertEqual(result['revision'],3)
        self.assertTrue(result['data_complete'])
        self.assertEqual(result['gis_max'],.4)
        self.assertEqual(result['elec_max'],.8)

    def test_both_high_sources_require_both_actions(self):
        self.spatial=spatial(.9)
        result=self.request().json()
        self.assertIn('疏散',result['suggestion']); self.assertIn('电气',result['suggestion'])

    def test_empty_source_keeps_incomplete_null_contract(self):
        for key in ('heatmap','devices'):
            with self.subTest(key=key):
                self.setUp()
                (self.spatial if key=='heatmap' else self.electrical)[key]=[]
                response=self.request()
                self.assertEqual(response.status_code,200)
                self.assertIsNone(response.json()['overall_risk'])
                self.assertFalse(response.json()['data_complete'])

    def test_bad_zone_records_return_unavailable(self):
        for score in (True,None,-.1,1.1,float('nan'),float('inf'),'0.7'):
            with self.subTest(score=score):
                # 非标准非有限值通过 MockTransport 的原始 JSON 返回。
                original=httpx.AsyncClient
                self.spatial['heatmap'][0]['risk_score']=score
                import json
                def transport(request):
                    return httpx.Response(200,content=json.dumps(self.spatial if request.url.path=='/state' else self.electrical))
                with patch.object(agent.httpx,'AsyncClient',side_effect=lambda *a,**kw:original(transport=httpx.MockTransport(transport),*a,**kw)):
                    self.assertEqual(self.client.get('/risk').status_code,503)

    def test_stale_and_invalid_devices_remain_unknown(self):
        changes=[{'timestamp':None},{'timestamp':123},{'timestamp':datetime.now(timezone.utc).replace(tzinfo=None).isoformat()},
                 {'timestamp':(datetime.now(timezone.utc)-timedelta(seconds=121)).isoformat()},
                 {'timestamp':(datetime.now(timezone.utc)+timedelta(seconds=60)).isoformat()},
                 {'status':'offline'},{'risk_score':1.1},{'load':-1},{'leakage':-1}]
        for change in changes:
            with self.subTest(change=change):
                self.electrical['devices']=[{**device(),**change}]
                result=self.request().json()
                self.assertIsNone(result['overall_risk'])
                self.assertEqual(result['unknown_devices'],1)
                self.assertEqual(result['known_risk_score'],.4)

    def test_threshold_precision_and_valid_zero(self):
        for score,word in [(0,'保持'),(.299,'保持'),(.3,'加强'),(.699,'加强'),(.7,'立即')]:
            with self.subTest(score=score):
                self.spatial=spatial(0);self.electrical['devices']=[device(score)]
                result=self.request().json()
                self.assertEqual(result['overall_risk'],score)
                self.assertTrue(result['data_complete'])
                self.assertIn(word,result['suggestion'])

    def test_upstream_failure_is_not_a_low_score(self):
        self.fail=True
        self.assertEqual(self.request().status_code,503)

    def test_dashboard_uses_same_fusion_and_incomplete_state(self):
        self.spatial['unknown_people']=1
        result=self.request('/dashboard').json()
        self.assertFalse(result['data_complete']);self.assertIsNone(result['overall_risk'])
