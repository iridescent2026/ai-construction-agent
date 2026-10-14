import pytest
from gis.workflow_language import mentioned_devices, interpret


@pytest.mark.parametrize('query,expected', [
    ('B01什么状态', {'B-01'}),
    ('B1什么状态', {'B-01'}),
    ('请查B-01的状态', {'B-01'}),
    ('b01状态', {'B-01'}),
    ('Ｂ０１什么状态', {'B-01'}),
    ('B－０１状态', {'B-01'}),
    ('B—1状态', {'B-01'}),
    ('B 01状态', {'B-01'}),
    ('A12与B02状态', {'A-12', 'B-02'}),
    ('B01和B-01状态', {'B-01'}),
    ('E1状态', {'E-01'}),
    ('B99状态', {'B-99'}),
    ('B123状态', {'B-123'}),
    ('USB01状态', set()),
    ('B01port状态', set()),
])
def test_device_ids_accept_natural_chinese_boundaries_without_partial_matches(query, expected):
    assert mentioned_devices(query) == expected


def test_explicit_device_overrides_selected_device_with_or_without_model(monkeypatch, tmp_path):
    monkeypatch.setenv('WORKFLOW_MODEL_ENABLED', '0')
    result = interpret('B01什么状态', 'B-05')
    assert result['entityId'] == 'B-01'
    assert result['intent'] == 'status'
    assert not result['clarification']

    monkeypatch.setenv('WORKFLOW_MODEL_ENABLED', '1')
    monkeypatch.setenv('WORKFLOW_MODEL_API_KEY', 'test-fixture-only')
    monkeypatch.setenv('WORKFLOW_QUOTA_DB_PATH', str(tmp_path/'quota.db'))
    from gis.model_quota import ModelQuota
    monkeypatch.setattr(ModelQuota, 'acquire', lambda *_: None)
    class Reply:
        def raise_for_status(self): pass
        def json(self): return {'choices': [{'message': {'content': '{"intents":["status"]}'}}]}
    import gis.workflow_language as language
    monkeypatch.setattr(language.httpx, 'post', lambda *_args, **_kwargs: Reply())
    result = interpret('B01什么状态', 'B-05')
    assert result['entityId'] == 'B-01'
    assert result['engine'] == 'language-model-classification'


def test_mixed_aliases_of_different_devices_require_clarification(monkeypatch):
    monkeypatch.setenv('WORKFLOW_MODEL_ENABLED', '0')
    result = interpret('B01和B-02什么状态', 'B-05')
    assert result['clarification']
    result = interpret('B01和B-01什么状态', 'B-05')
    assert result['entityId'] == 'B-01'
    assert not result['clarification']


@pytest.mark.parametrize('query,expected', [
    ('b01怎么样', 'B-01'), ('a1状态', 'A-01'), ('e01状态', 'E-01'),
    ('高压柜正常吗', 'B-01'), ('循环排水泵怎么样', 'B-05'),
    ('plc柜电流多少', 'B-04'), ('ｕｐｓ电源状态', 'B-12'),
    ('cnc运行情况', 'A-02'), ('变压器温度', 'B-02'),
    ('龙门吊状态', 'E-05'), ('挖掘机1号状态', 'E-01'),
    ('A区空压机状态', 'A-05'), ('b区空压机状态', 'B-10'),
    ('动力区操作台状态', 'B-07'), ('装配区水泵状态', 'A-07'),
    ('空气压缩机组状态', 'A-05'), ('B区空气压缩机组状态', 'B-10'),
    ('双机空气压缩机组状态', 'B-10'), ('b10空压机状态', 'B-10'),
])
def test_device_aliases_and_area_qualifiers(monkeypatch, query, expected):
    monkeypatch.setenv('WORKFLOW_MODEL_ENABLED', '0')
    result = interpret(query, 'B-05')
    assert result['entityId'] == expected
    assert result['intent'] == 'status'
    assert not result['clarification']


def test_every_catalogue_device_full_title_is_recognized(monkeypatch):
    monkeypatch.setenv('WORKFLOW_MODEL_ENABLED', '0')
    from gis.device_names import default_devices
    for device in default_devices():
        if device['kind'] != 'device':
            continue
        result = interpret(device['title'] + '现在怎么样', 'B-05')
        assert not result['clarification'], (device['id'], result)
        assert result['entityId'] == device['id']


@pytest.mark.parametrize('query,ids', [
    ('空压机状态', ['A-05', 'B-10']),
    ('机器人状态', ['A-10', 'A-11']),
    ('水泵状态', ['A-07', 'B-05']),
    ('配电柜状态', ['A-06', 'B-01']),
    ('操作台状态', ['A-08', 'B-07']),
    ('挖掘机状态', ['E-01', 'E-02']),
    ('高压柜和排水泵状态', ['B-01', 'B-05']),
])
def test_shared_names_offer_named_choices(monkeypatch, query, ids):
    monkeypatch.setenv('WORKFLOW_MODEL_ENABLED', '0')
    result = interpret(query, 'B-05')
    assert result['clarification']
    for id in ids:
        assert id + ' · ' in result['clarification']


@pytest.mark.parametrize('query', ['A区变压器状态', 'b01排水泵状态'])
def test_inconsistent_area_or_id_and_name_asks_for_clarification(monkeypatch, query):
    monkeypatch.setenv('WORKFLOW_MODEL_ENABLED', '0')
    assert interpret(query, 'B-05')['clarification']


def test_runtime_names_and_english_token_boundaries():
    from gis.device_names import named_devices
    runtime = [{'id': 'B-01', 'title': '一号进线柜', 'kind': 'device', 'view': 'b'}]
    assert named_devices('一号进线柜状态', runtime) == {'B-01'}
    assert named_devices('高压柜状态', runtime) == {'B-01'}
    assert not named_devices('UPS状态', runtime)
    assert not named_devices('高压柜状态', [])
    assert not named_devices('upstream状态 plc_code状态')
