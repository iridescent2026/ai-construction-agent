import httpx
import pytest
from test_device_workflow import system, login
from gis import workflow_language as language

@pytest.fixture
def aliyun(monkeypatch,tmp_path):
    monkeypatch.setenv('WORKFLOW_MODEL_ENABLED','1')
    monkeypatch.setenv('WORKFLOW_MODEL_PROVIDER','aliyun')
    monkeypatch.setenv('WORKFLOW_TEMPLATE_FIRST','1')
    monkeypatch.setenv('DASHSCOPE_API_KEY','fixture-only-not-a-real-key')
    monkeypatch.setenv('WORKFLOW_QUOTA_DB_PATH',str(tmp_path/'quota.db'))
    monkeypatch.delenv('WORKFLOW_MODEL_NAME',raising=False)
    monkeypatch.delenv('WORKFLOW_MODEL_BASE_URL',raising=False)
    calls=[]
    def post(url,**kwargs):
        calls.append((url,kwargs['json']))
        return httpx.Response(200,json={'choices':[{'message':{'content':'微积分研究变化率和累积量。'}}]},request=httpx.Request('POST',url))
    monkeypatch.setattr(language.httpx,'post',post)
    return calls

@pytest.mark.parametrize('query,selected,expected',[
    ('b05 STATUS','B-05','B-05'),('Ｂ－０５\n状态','B-05','B-05'),
    ('状态','ｂ０５','B-05'),('cnc运行情况','B-05','A-02')])
def test_templates_normalize_format_without_model(system,aliyun,query,selected,expected):
    _,client=system
    result=client.post('/factory/workflow/chat',headers=login(client,'observer'),json={'query':query,'entityId':selected}).json()
    assert result['success'] and result['intent']=='status' and result['entityId']==expected
    assert aliyun==[]

@pytest.mark.parametrize('query',['微积分是什么','CNC是什么','压力的定义','现在流行什么','写一段Python代码'])
def test_outside_template_calls_aliyun_once(system,aliyun,query):
    _,client=system
    result=client.post('/factory/workflow/chat',headers=login(client,'observer'),json={'query':query}).json()
    assert result['success'] and result['intent']=='general' and result['engine']=='aliyun-general-chat'
    assert len(aliyun)==1
    url,payload=aliyun[0]
    assert url=='https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
    assert payload['model']=='qwen-plus' and 'response_format' not in payload
    assert result['draft'] is None

def test_free_tier_error_is_not_an_unrelated_template(system,aliyun,monkeypatch):
    _,client=system
    def fail(url,**kwargs):
        response=httpx.Response(403,json={'error':{'code':'AllocationQuota.FreeTierOnly'}},request=httpx.Request('POST',url))
        response.raise_for_status()
    monkeypatch.setattr(language.httpx,'post',fail)
    result=client.post('/factory/workflow/chat',headers=login(client,'observer'),json={'query':'微积分是什么'}).json()
    assert not result['success'] and result['intent']=='general'
    assert '免费额度用完即停' in result['answer'] and result['draft'] is None

def test_complete_endpoint_is_not_appended_twice():
    url='https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
    assert language.completion_url(url)==url

def test_encrypted_local_settings_and_environment_override(monkeypatch):
    from gis import local_model_settings
    monkeypatch.setattr(local_model_settings,'local_model_settings',lambda:{
        'provider':'aliyun','model':'qwen-plus','key':'fixture-local-key','enabled':'1'})
    for name in ('WORKFLOW_MODEL_ENABLED','WORKFLOW_MODEL_PROVIDER','WORKFLOW_MODEL_NAME',
                 'WORKFLOW_MODEL_API_KEY','DASHSCOPE_API_KEY','WORKFLOW_MODEL_BASE_URL'):
        monkeypatch.delenv(name,raising=False)
    assert language.model_enabled()
    assert language.model_config()['provider']=='aliyun'
    assert language.model_config()['base']=='https://dashscope.aliyuncs.com/compatible-mode/v1'
    monkeypatch.setenv('WORKFLOW_MODEL_ENABLED','0')
    assert not language.model_enabled()
    monkeypatch.setenv('DASHSCOPE_API_KEY','fixture-env-key')
    assert language.model_config()['key']=='fixture-env-key'
