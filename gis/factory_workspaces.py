"""ASGI isolation for disposable per-browser prototype workspaces."""
import hashlib, os, secrets, threading, time, asyncio
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from common.database import connect
class Workspaces:
    def __init__(self,app,path):
        self.app=app;self.path=path;self.children={};self.lock=threading.RLock();self.creation_times={}
        with connect(path) as db:db.execute('CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY,expires DOUBLE PRECISION)')
    def create(self,source='local'):
        if not self.app.state.factory.demo_enabled:raise HTTPException(403,'真实项目禁止创建模拟空间')
        token=secrets.token_urlsafe(32);key=hashlib.sha256(token.encode()).hexdigest()
        with self.lock,connect(self.path) as db:
            recent=[t for t in self.creation_times.get(source,[]) if time.time()-t<3600]
            if len(recent)>=12:raise HTTPException(429,'本网络创建演示空间过于频繁，请使用已创建的空间或稍后再试')
            if db.execute('SELECT COUNT(*) FROM workspaces').fetchone()[0]>=40:raise HTTPException(429,'已保留的演示空间达到40个上限，请联系项目管理员归档')
            if db.execute('SELECT COUNT(*) FROM workspaces WHERE expires>?',(time.time(),)).fetchone()[0]>=20:raise HTTPException(429,'演示空间已满，请稍后再试')
            db.execute('INSERT INTO workspaces VALUES(?,?)',(key,time.time()+86400))
            self.creation_times[source]=[*recent,time.time()]
        return {'workspace':token,'expiresAt':time.time()+86400,'message':'个人模拟空间，24小时有效；与其他访客隔离，正式资料请使用项目账号'}
    def child(self,token):
        if len(token)>100:raise HTTPException(401,'演示空间无效')
        key=hashlib.sha256(token.encode()).hexdigest()
        with self.lock:
            with connect(self.path) as db:row=db.execute('SELECT expires FROM workspaces WHERE id=?',(key,)).fetchone()
            if not row or row[0]<time.time():raise HTTPException(401,'演示空间已过期，请从登录页重新进入')
            if key not in self.children:
                from gis.factory import install_factory
                child=FastAPI()
                from common.runtime import configure_api
                configure_api(child)
                install_factory(child,path_override=self.path.with_name('sandbox-'+key[:24]+'.factory.db'),sandbox=True)
                if os.getenv('FACTORY_ANALYSIS_DEMO','0')=='1':child.state.factory_demo_feed.start()
                self.children[key]=child
            return self.children[key]
    def tick(self):
        with self.lock,connect(self.path) as db:
            valid={r[0] for r in db.execute('SELECT id FROM workspaces WHERE expires>?',(time.time(),))}
            self.children={k:child for k,child in self.children.items() if k in valid}
        for child in list(self.children.values()):
            child.state.factory.tick();child.state.factory_demo_feed.tick()
            # Bound history and Postgres traffic in personal demonstration spaces.
            if int(time.time())%5==0:child.state.factory_analysis.record(child.state.factory.snapshot())
    async def __call__(self,scope,receive,send):
        if scope['type']!='http' or scope.get('method')=='OPTIONS' or not scope['path'].startswith('/factory'):
            return await self.app_router(scope,receive,send)
        request=Request(scope);path=scope['path'];token=request.headers.get('x-demo-workspace')
        try:
            if path=='/factory/auth/demo-session' and request.method=='POST':
                return await self.app_router(scope,receive,send)
            if token:
                child=await asyncio.to_thread(self.child,token)
                return await child(scope,receive,send)
            public={'/factory/auth/login','/factory/auth/mode','/factory/auth/demo-session'}
            if (not self.app.state.factory.demo_enabled or os.getenv('DEMO_WORKSPACES_REQUIRED','0')=='1') and path not in public:
                await asyncio.to_thread(self.app.state.factory_accounts.require,request)
            if os.getenv('DEMO_WORKSPACES_REQUIRED','0')=='1' and request.method not in ('GET','HEAD','OPTIONS') and path not in public:
                user=await asyncio.to_thread(self.app.state.factory_accounts.require,request)
                if user['id'].startswith('demo-'):raise HTTPException(403,'请从登录页进入个人演示空间，公共展示数据不允许演示账号修改')
            if os.getenv('DEMO_WORKSPACES_REQUIRED','0')=='1' and path=='/factory/auth/login':
                # Public demo accounts may only sign in inside an isolated space.
                body=await request.body()
                import json
                try:command=json.loads(body)
                except (ValueError,TypeError):raise HTTPException(422,'登录内容必须为有效 JSON')
                if isinstance(command,dict) and isinstance(command.get('username'),str) and command['username'].startswith('demo-'):raise HTTPException(403,'请先进入个人演示空间')
                async def replay():return {'type':'http.request','body':body,'more_body':False}
                return await self.app_router(scope,replay,send)
            return await self.app_router(scope,receive,send)
        except HTTPException as error:return await JSONResponse({'detail':error.detail},status_code=error.status_code)(scope,receive,send)
def install_workspaces(app,store):
    manager=Workspaces(app,store.path.with_suffix('.workspaces.db'))
    app.state.workspaces=manager
    @app.post('/factory/auth/demo-session')
    def create_demo_space(request:Request):return manager.create(request.client.host if request.client else 'local')
    # Wrap the middleware layer without recursively dispatching the parent app.
    from starlette.middleware.base import BaseHTTPMiddleware
    class Isolation:
        def __init__(self,app):self.downstream=app
        async def __call__(self,scope,receive,send):
            manager.app_router=self.downstream
            return await manager(scope,receive,send)
    app.add_middleware(Isolation)
