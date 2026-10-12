import httpx
from fastapi.testclient import TestClient
import cloud_gateway as gateway

def test_public_config_uses_viewers_same_origin_not_localhost():
    client=TestClient(gateway.app)
    response=client.get('/config.js')
    assert response.status_code==200 and 'location.origin' in response.text
    assert '127.0.0.1' not in response.text
    assert client.get('/').status_code==200
    assert client.get('/workbench.html').status_code==200

def test_cloud_proxy_forwards_identity_query_and_rejects_foreign_origin(monkeypatch):
    received=[]
    async def handler(request):
        received.append(request)
        if request.url.path.endswith('/auth/me'):return httpx.Response(200,json={'role':'observer'})
        return httpx.Response(200,json={'path':request.url.path})
    gateway.app.state.proxy=httpx.AsyncClient(transport=httpx.MockTransport(handler))
    client=TestClient(gateway.app)
    response=client.post('/api/gis/factory/workflow/chat?x=1',json={'query':'B-05 状态'},headers={'Origin':'https://testserver','Authorization':'Bearer example'})
    assert response.status_code==200
    assert received[-1].url.query==b'x=1'
    assert received[-1].headers['authorization']=='Bearer example'
    assert 'origin' not in received[-1].headers
    assert client.post('/api/gis/factory/observations',json={},headers={'Origin':'https://wrong.example'}).status_code==403
    assert client.post('/api/gis/factory/demo',json={}).status_code==403
    assert client.get('/api/unknown/x').status_code==404
    assert client.get('/api/gis/docs').status_code==404
    monkeypatch.setenv('PUBLIC_READ_ONLY','1')
    assert client.post('/api/gis/factory/auth/login',json={}).status_code==403
