"""验证新版真实工具执行路径和迁移后的范围/未知状态，不调用付费模型。"""
import unittest
from unittest.mock import patch, Mock
from fastapi.testclient import TestClient
from agent_support import agent
from test_risk import UpstreamFixture, device, spatial


class ChatTests(UpstreamFixture, unittest.TestCase):
    # 仅复用测试环境与上游 mock；综合风险用例不在此类重复运行。
    def ask(self,query,endpoint='/chat',body=None):
        import httpx
        original=httpx.AsyncClient
        self.paths=[]
        def transport(request):
            self.paths.append(request.url.path)
            if self.fail:return httpx.Response(503,json={'detail':'test unavailable'})
            return httpx.Response(200,json=self.spatial if request.url.path=='/state' else self.electrical)
        with patch.object(agent.httpx,'AsyncClient',side_effect=lambda *a,**kw:original(transport=httpx.MockTransport(transport),*a,**kw)), \
                patch.object(agent.llm_client.chat.completions,'create',side_effect=AssertionError('不得调用真实模型')) as model:
            response=self.client.post(endpoint,params={'query':query},json=body) if body is not None else self.client.post(endpoint,params={'query':query})
            model.assert_not_called()
        self.assertEqual(response.status_code,200,response.text)
        return response.json()

    def test_route_needs_input_without_claiming_execution(self):
        for endpoint in ('/chat','/chat_llm'):
            result=self.ask('规划巡检路线',endpoint)
            self.assertFalse(result['success']);self.assertTrue(result['needs_input'])
            self.assertEqual(result['tool_calls'],[])

    def test_route_tools_share_solver_and_echo_risk_preference(self):
        body={'points':[{'id':'S','lng':120.008,'lat':30.293},
                        {'id':'H','lng':120.009,'lat':30.293,'risk':.9}],
              'start_id':'S','risk_priority_weight':5}
        for endpoint in ('/chat','/chat_llm'):
            result=self.ask('规划巡检路线',endpoint,body)
            self.assertTrue(result['success']);self.assertEqual(result['tool_calls'],['/route'])
            self.assertEqual(result['route_data']['route'],['S','H','S'])
            self.assertEqual(result['tool_results'][0]['input']['risk_priority_weight'],5)
            self.assertEqual(result['tool_results'][0]['output'],result['route_data'])
            self.assertFalse(result['route_data']['walkability_verified'])

    def test_route_failure_is_not_reported_as_success(self):
        with patch.object(agent,'optimize_route',side_effect=RuntimeError('solver unavailable')):
            body={'points':[{'id':'S','lng':120,'lat':30},{'id':'H','lng':120,'lat':31}],'start_id':'S'}
            result=self.ask('规划巡检路线',body=body)
        self.assertFalse(result['success']);self.assertEqual(result['tool_results'][0]['status'],'error')

    def test_highest_devices_preserve_ties_and_precision(self):
        self.electrical['devices']=[device(.699),{**device(.699),'device_id':'D2'}]
        for endpoint in ('/chat','/chat_llm'):
            result=self.ask('哪个电气设备风险最高',endpoint)
            self.assertCountEqual(result['highest_devices'],['D1','D2'])
            self.assertIn('0.699',result['answer']);self.assertEqual(self.paths,['/devices'])

    def test_unknown_devices_do_not_enter_highest_comparison(self):
        self.electrical['devices']=[device(.4),{**device(1),'device_id':'D2','status':'offline'}]
        result=self.ask('哪个设备最危险')
        self.assertEqual(result['highest_devices'],['D1']);self.assertIn('不能确认全场最高',result['answer'])
        self.electrical['devices']=[{**device(1),'status':'offline'}]
        result=self.ask('哪个设备最危险')
        self.assertFalse(result['assessment_available']);self.assertIn('无法判断',result['answer'])

    def test_medium_and_attention_devices_are_not_normal(self):
        self.electrical['devices']=[device(.4),{**device(.1),'device_id':'D2','alert':'需检查'}]
        result=self.ask('电气状态怎么样')
        self.assertEqual(result['groups']['中'],['D1']);self.assertEqual(result['groups']['关注'],['D2'])
        self.assertIn('中风险',result['answer']);self.assertNotIn('均未触发',result['answer'])

    def test_highest_zone_query_is_scoped_to_spatial_data(self):
        self.spatial=spatial(.699)
        self.spatial['heatmap'].append({**self.spatial['heatmap'][0],'zone_id':'Z2'})
        for endpoint in ('/chat','/chat_llm'):
            result=self.ask('哪个区域风险最高',endpoint)
            self.assertEqual(self.paths,['/state']);self.assertIn('Z1',result['answer']);self.assertIn('Z2',result['answer'])
            self.assertIn('0.699',result['answer']);self.assertEqual(result['revision'],3)

    def test_unknown_people_qualify_zone_assessment(self):
        self.spatial['unknown_people']=1
        result=self.ask('哪个区域最危险')
        self.assertIn('不能确认全场最高',result['answer'])

    def test_combined_risk_keeps_source_level_and_incomplete_state(self):
        self.spatial=spatial(.699);self.electrical['devices']=[device(.2)]
        result=self.ask('工地整体风险怎么样')
        self.assertIn('0.699',result['answer']);self.assertIn('中风险',result['answer']);self.assertIn('空间风险',result['answer'])
        self.spatial['unknown_people']=1
        result=self.ask('工地整体风险怎么样')
        self.assertIn('数据不完整',result['answer'])

    def test_failed_source_and_empty_devices_never_appear_normal(self):
        self.fail=True
        result=self.ask('电气状态怎么样')
        self.assertFalse(result['success']);self.assertIn('未知',result['answer'])
        self.fail=False;self.electrical['devices']=[]
        result=self.ask('电气状态怎么样')
        self.assertIn('无法判断',result['answer'])

    def test_unconfigured_llm_returns_actionable_failure(self):
        result=self.ask('解释一下现在的现场情况','/chat_llm')
        self.assertFalse(result['success']);self.assertTrue(result['needs_configuration'])
        self.assertEqual(result['tool_calls'],[])

    def test_unknown_model_intent_has_defined_confidence(self):
        from types import SimpleNamespace
        output=SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='{"intent":"unknown"}'))])
        with patch.object(agent,'DEEPSEEK_KEY','unit-test-no-network'), \
                patch.object(agent.llm_client.chat.completions,'create',return_value=output):
            response=self.client.post('/chat_llm',params={'query':'你好','session_id':'unit-unknown'})
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['tool_calls'],[])
        self.assertEqual(response.json()['confidence'],0)
