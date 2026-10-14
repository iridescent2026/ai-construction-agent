"""One public origin for the website and three private APIs in a demo container."""
import asyncio
import os
from pathlib import Path
import subprocess
import sys
from contextlib import asynccontextmanager
import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent
PORTS = {'gis': 8000, 'electrical': 8001, 'agent': 8002}
MAX_BODY = 4 * 1024 * 1024
HOP_HEADERS = {'connection','keep-alive','proxy-authenticate','proxy-authorization',
               'te','trailer','transfer-encoding','upgrade','content-length','content-encoding'}

@asynccontextmanager
async def lifespan(app):
    data = Path(os.environ.get('DATA_DIR', str(ROOT/'cloud-data')))
    data.mkdir(parents=True,exist_ok=True)
    env={**os.environ,'GIS_API':'http://127.0.0.1:8000','ELEC_API':'http://127.0.0.1:8001',
         'FACTORY_DB_PATH':str(data/'factory.db'),'GIS_DB_PATH':str(data/'gis.db'),
         'ELECTRICAL_DB_PATH':str(data/'electrical.db'),'AGENT_DB_PATH':str(data/'agent.db')}
    env.setdefault('DEMO_MODE','1');env.setdefault('FACTORY_ANALYSIS_DEMO','1');env.setdefault('DEMO_WORKSPACES_REQUIRED','1')
    commands=[
        ['-m','uvicorn','gis.main:app','--host','127.0.0.1','--port','8000'],
        ['-m','uvicorn','electrical.main:app','--host','127.0.0.1','--port','8001'],
        ['-m','uvicorn','main:app','--app-dir',str(ROOT/'math'),'--host','127.0.0.1','--port','8002'],
    ]
    children=[]
    try:
        for command in commands:
            children.append(subprocess.Popen([sys.executable,*command],cwd=ROOT,env=env))
        app.state.children=children
        async with httpx.AsyncClient(timeout=20,trust_env=False) as client:
            app.state.proxy=client
            for _ in range(60):
                if any(p.poll() is not None for p in children):raise RuntimeError('A private API exited during startup')
                try:
                    results=await asyncio.gather(*(client.get('http://127.0.0.1:'+str(port)+'/health',timeout=1) for port in PORTS.values()))
                    if all(r.status_code==200 for r in results):break
                except httpx.HTTPError:pass
                await asyncio.sleep(1)
            else:raise RuntimeError('Private APIs did not become healthy')
            yield
    finally:
        for child in children:
            if child.poll() is None:child.terminate()
        for child in children:
            try:await asyncio.to_thread(child.wait,timeout=5)
            except subprocess.TimeoutExpired:
                child.kill();await asyncio.to_thread(child.wait)

app=FastAPI(lifespan=lifespan,docs_url=None,redoc_url=None,openapi_url=None)

@app.get('/health')
async def health():
    try:
        results=await asyncio.gather(*(app.state.proxy.get('http://127.0.0.1:'+str(port)+'/health',timeout=2) for port in PORTS.values()))
        healthy=all(r.status_code==200 for r in results)
    except (httpx.HTTPError,AttributeError):healthy=False
    return JSONResponse({'status':'ok' if healthy else 'unavailable','mode':'public-demo'},status_code=200 if healthy else 503)

@app.get('/config.js')
def config():
    content="window.APP_CONFIG = {gis:location.origin+'/api/gis',electrical:location.origin+'/api/electrical',agent:location.origin+'/api/agent'};"
    return Response(content,media_type='text/javascript',headers={'Cache-Control':'no-store'})

def valid_origin(request):
    origin=request.headers.get('origin')
    if not origin:return True
    expected=os.environ.get('PUBLIC_ORIGIN','').rstrip('/')
    if expected:return origin==expected
    host=request.headers.get('host','')
    return origin in ('http://'+host,'https://'+host)

@app.api_route('/api/{service}/{path:path}',methods=['GET','POST','OPTIONS'])
async def proxy(service:str,path:str,request:Request):
    if service not in PORTS:return JSONResponse({'detail':'未知服务'},status_code=404)
    if not valid_origin(request):return JSONResponse({'detail':'不允许此网页来源操作演示'},status_code=403)
    if request.method=='OPTIONS':return Response(status_code=204)
    if path in ('docs','redoc','openapi.json'):return JSONResponse({'detail':'公网入口不开放内部接口文档'},status_code=404)
    if os.getenv('DEMO_WORKSPACES_REQUIRED','1')=='1' and request.method not in ('GET','HEAD','OPTIONS') and not (service=='gis' and path.startswith('factory/')):
        return JSONResponse({'detail':'公开演示只接受隔离工厂工作台的操作；旧版共享写接口未开放'},status_code=403)
    if request.method=='POST' and os.getenv('PUBLIC_READ_ONLY','0')=='1':
        return JSONResponse({'detail':'此公开实例只读；完整流程请运行提交代码包'},status_code=403)
    chunks=[];size=0
    async for chunk in request.stream():
        size+=len(chunk)
        if size>MAX_BODY:return JSONResponse({'detail':'请求超过4MB'},status_code=413)
        chunks.append(chunk)
    headers={k:v for k,v in request.headers.items() if k.lower() not in HOP_HEADERS|{'host','origin','cookie','x-forwarded-for','x-forwarded-host','x-forwarded-proto'}}
    client=app.state.proxy
    # Legacy simulation controls lack their own account checks; add them here.
    if request.method=='POST' and service=='gis' and path in ('factory/demo','factory/analysis/demo-feed','simulation/tick','simulation/motion','check_danger','check_danger_batch'):
        try:
            auth=await client.get('http://127.0.0.1:8000/factory/auth/me',headers=headers)
            if auth.status_code!=200:return JSONResponse({'detail':'模拟控制请先登录安全员账号'},status_code=401)
            if auth.json()['role'] not in ('safety','admin'):return JSONResponse({'detail':'当前账号无模拟控制权限'},status_code=403)
        except httpx.HTTPError:return JSONResponse({'detail':'账号服务不可用'},status_code=503)
    query=request.url.query
    url='http://127.0.0.1:'+str(PORTS[service])+'/'+path+('?' + query if query else '')
    try:
        result=await client.request(request.method,url,headers=headers,content=b''.join(chunks),timeout=40 if service=='gis' and path=='factory/workflow/chat' else 20)
    except httpx.HTTPError:return JSONResponse({'detail':'后台服务暂不可用'},status_code=503)
    response_headers={k:v for k,v in result.headers.items() if k.lower() not in HOP_HEADERS}
    response_headers['Cache-Control']='no-store'
    return Response(result.content,status_code=result.status_code,headers=response_headers)

app.mount('/',StaticFiles(directory=ROOT/'frontend',html=True),name='frontend')
