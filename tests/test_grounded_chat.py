import json
import httpx
import pytest
from test_device_workflow import system, login
from gis import workflow_language as language


@pytest.fixture
def grounded(monkeypatch,tmp_path):
    for key,value in {'WORKFLOW_MODEL_ENABLED':'1','WORKFLOW_MODEL_PROVIDER':'aliyun',
                      'DASHSCOPE_API_KEY':'fixture-not-a-live-key','WORKFLOW_TEMPLATE_FIRST':'1',
                      'WORKFLOW_QUOTA_DB_PATH':str(tmp_path/'quota.db')}.items():
        monkeypatch.setenv(key,value)
    calls=[]
    def post(url,**kwargs):
        payload=kwargs['json'];calls.append(payload)
        body=json.loads(payload['messages'][-1]['content'])
        assert body['backendEvidence']['device']['id']=='B-05'
        assert 'observedAtBeijing' in body['backendEvidence']['observation']
        if body['backendEvidence']['intents']==['status']:assert 'connections' not in body['backendEvidence']
        if body['backendEvidence']['intents']==['impact']:assert 'measurements' not in body['backendEvidence']['observation']
        text='可能影响：台账中的候选关联仍需核实，不能认定上游设备会损坏。' if 'impact' in body['backendEvidence']['intents'] else '当前状态：依据后台观测，仍需核对适用规则。'
        return httpx.Response(200,json={'choices':[{'message':{'content':text}}]},request=httpx.Request('POST',url))
    monkeypatch.setattr(language.httpx,'post',post)
    return calls


@pytest.mark.parametrize('query,expected',[
    ('B05状态',['status']),('b05 STATUS',['status']),('Ｂ－０５ 现在什么情况',['status']),
    ('B05坏了有什么影响',['impact']),('B05故障会造成什么后果',['impact']),
    ('B05停了会怎么样',['impact']),('B05坏了吗',['status']),
    ('这台泵现在什么情况，波及哪里？',['impact','status'])])
def test_question_intents_remain_distinct(query,expected,monkeypatch):
    monkeypatch.setenv('WORKFLOW_TEMPLATE_FIRST','1')
    result=language.interpret(query,'B-05')
    assert result['intents']==expected and not result['outsideScope']


def test_free_questions_get_different_grounded_answers_and_no_writes(system,grounded):
    _,client=system;headers=login(client,'observer')
    before=client.get('/factory/analysis',headers=headers).json()['orders']
    answers=[]
    for query,intent in [('B05状态','status'),('B05坏了有什么影响','impact')]:
        result=client.post('/factory/workflow/chat',headers=headers,json={
            'query':query,'entityId':'B-05','answerMode':'grounded'}).json()
        assert result['success'] and result['engine']=='aliyun-grounded-chat'
        assert result['intent']==intent and result['draft'] is None
        assert '核查依据：B-05' in result['answer']
        assert result['tool_results'][-1]['tool']=='grounded_chat'
        assert result['tool_results'][-1]['factoryRevision']==result['case']['factoryRevision']
        answers.append(result['answer'])
    assert len(grounded)==2 and answers[0]!=answers[1]
    assert client.get('/factory/analysis',headers=headers).json()['orders']==before
    payload=json.loads(grounded[-1]['messages'][-1]['content'])
    assert all('observation' not in n for n in payload['backendEvidence']['connections']['nodes'])


def test_shortcut_still_uses_template_without_api(system,grounded):
    _,client=system
    result=client.post('/factory/workflow/chat',headers=login(client,'observer'),json={
        'query':'B05状态','answerMode':'template'}).json()
    assert result['success'] and result['engine']=='rule-tool-orchestrator' and grounded==[]


def test_provider_failure_is_explicit_grounded_fallback(system,grounded,monkeypatch):
    _,client=system
    def fail(*args,**kwargs):raise httpx.ConnectError('fixture-offline')
    monkeypatch.setattr(language.httpx,'post',fail)
    result=client.post('/factory/workflow/chat',headers=login(client,'observer'),json={
        'query':'B05坏了有什么影响','answerMode':'grounded'}).json()
    assert result['success'] and result['engine']=='rule-tool-fallback'
    assert '本地核查结果' in result['answer'] and '故障影响核查' in result['answer']
    assert '故障假设' in result['answer'] and result['draft'] is None


def test_grounded_ambiguity_and_write_permissions_do_not_call_model(system,grounded):
    _,client=system;headers=login(client,'observer')
    assert client.post('/factory/workflow/chat',json={'query':'B05状态','answerMode':'grounded'}).status_code==401
    result=client.post('/factory/workflow/chat',headers=headers,json={'query':'空压机状态','answerMode':'grounded'}).json()
    assert result['needsInput'] and grounded==[]
    response=client.post('/factory/workflow/chat',headers=headers,json={'query':'B05创建核查工单','answerMode':'grounded'})
    assert response.status_code==403 and grounded==[]


def test_invented_engineering_limit_is_rejected(system,grounded,monkeypatch):
    _,client=system
    def invented(url,**kwargs):
        return httpx.Response(200,json={'choices':[{'message':{'content':'例如压力限值应设为0.3 MPa。'}}]},request=httpx.Request('POST',url))
    monkeypatch.setattr(language.httpx,'post',invented)
    result=client.post('/factory/workflow/chat',headers=login(client,'observer'),json={
        'query':'B05坏了有什么影响','answerMode':'grounded'}).json()
    assert result['engine']=='rule-tool-fallback'
    assert '限值应设为' not in result['answer']
    assert result['tool_results'][-1]['output']['reason']=='unsupported_measurement'
