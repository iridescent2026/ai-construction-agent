"""ASGI isolation for disposable per-browser prototype workspaces."""
import hashlib, os, secrets, threading, time, asyncio
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from typing import Literal
from fastapi.responses import JSONResponse
from common.database import connect
class ArchiveCommand(BaseModel):
    model_config=ConfigDict(extra='forbid')
    workspaceId: str = Field(pattern=r'^[a-f0-9]{64}$')
    confirmation: Literal['归档过期演示空间','恢复归档记录']

class Workspaces:
    def __init__(self,app,path):
        self.app=app;self.path=path;self.children={};self.lock=threading.RLock();self.creation_times={};self.last_cleanup=0
        self.idle_seconds=600
        with connect(path) as db:
            db.execute('CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY,expires DOUBLE PRECISION)')
            db.execute('CREATE TABLE IF NOT EXISTS workspace_archives (id TEXT PRIMARY KEY,actor TEXT NOT NULL,at DOUBLE PRECISION NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS workspace_archive_history (id TEXT PRIMARY KEY,workspace TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,at DOUBLE PRECISION NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS workspace_activity (id TEXT PRIMARY KEY,last_seen DOUBLE PRECISION NOT NULL)')
    def active_count(self,db,now):
        return db.execute('SELECT COUNT(*) FROM workspaces w JOIN workspace_activity s ON s.id=w.id WHERE w.expires>? AND s.last_seen>? AND NOT EXISTS (SELECT 1 FROM workspace_archives a WHERE a.id=w.id)',(now,now-self.idle_seconds)).fetchone()[0]
    def create(self,source='local'):
        if not self.app.state.factory.demo_enabled:raise HTTPException(403,'真实项目禁止创建模拟空间')
        token=secrets.token_urlsafe(32);key=hashlib.sha256(token.encode()).hexdigest()
        with self.lock,connect(self.path) as db:
            db.execute('BEGIN IMMEDIATE')
            recent=[t for t in self.creation_times.get(source,[]) if time.time()-t<3600]
            if len(recent)>=12:raise HTTPException(429,'本网络创建演示空间过于频繁，请使用已创建的空间或稍后再试')
            if db.execute('SELECT COUNT(*) FROM workspaces w WHERE NOT EXISTS (SELECT 1 FROM workspace_archives a WHERE a.id=w.id)').fetchone()[0]>=40:raise HTTPException(429,'已保留的演示空间达到40个上限，请联系项目管理员归档')
            if self.active_count(db,time.time())>=20:raise HTTPException(429,'当前同时使用的演示空间已达20个，请稍后重试；已有浏览器可继续使用原空间')
            db.execute('INSERT INTO workspaces VALUES(?,?)',(key,time.time()+86400))
            db.execute('INSERT INTO workspace_activity VALUES(?,?)',(key,time.time()))
            self.creation_times[source]=[*recent,time.time()]
        return {'workspace':token,'expiresAt':time.time()+86400,'message':'个人模拟空间，24小时有效；与其他访客隔离，正式资料请使用项目账号'}
    def inventory(self):
        with self.lock,connect(self.path) as db:
            rows=db.execute('SELECT w.id,w.expires,a.actor,a.at,s.last_seen FROM workspaces w LEFT JOIN workspace_archives a ON a.id=w.id LEFT JOIN workspace_activity s ON s.id=w.id ORDER BY w.expires DESC LIMIT 2000').fetchall()
            retained=db.execute('SELECT COUNT(*) FROM workspaces w WHERE NOT EXISTS (SELECT 1 FROM workspace_archives a WHERE a.id=w.id)').fetchone()[0]
            archived=db.execute('SELECT COUNT(*) FROM workspace_archives').fetchone()[0]
            history=db.execute('SELECT workspace,actor,action,at FROM workspace_archive_history ORDER BY at DESC LIMIT 500').fetchall()
            active=self.active_count(db,time.time())
        now=time.time()
        return {'items':[{'id':r[0],'label':r[0][:12],'expiresAt':r[1],'expired':r[1]<=now,'archived':r[3] is not None,'archivedBy':r[2],'archivedAt':r[3],'lastSeen':r[4],'active':r[1]>now and r[3] is None and r[4] is not None and r[4]>now-self.idle_seconds} for r in rows],
                'retained':retained,'archived':archived,'retainedLimit':40,'activeLimit':20,'active':active,'idleSeconds':self.idle_seconds,
                'history':[{'workspaceId':r[0],'actor':r[1],'action':r[2],'at':r[3]} for r in history],
                'boundary':'只归档过期演示空间，释放应用数量限额；业务数据库和正式项目不删除，数据库容量不会释放。恢复只取消归档，不延长旧凭据有效期。'}
    def archive(self,id,user,restore=False):
        with self.lock,connect(self.path) as db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute('SELECT expires FROM workspaces WHERE id=?',(id,)).fetchone()
            if not row:raise HTTPException(404,'演示空间不存在')
            receipt=db.execute('SELECT actor,at FROM workspace_archives WHERE id=?',(id,)).fetchone()
            if restore:
                if receipt:
                    retained=db.execute('SELECT COUNT(*) FROM workspaces w WHERE NOT EXISTS (SELECT 1 FROM workspace_archives a WHERE a.id=w.id)').fetchone()[0]
                    if retained>=40:raise HTTPException(409,'保留空间达到40个，请先归档其他过期空间')
                    db.execute('DELETE FROM workspace_archives WHERE id=?',(id,))
                    db.execute('INSERT INTO workspace_archive_history VALUES(?,?,?,?,?)',(secrets.token_hex(16),id,user['id'],'restore',time.time()))
                return {'restored':True,'workspaceId':id,'expiresAt':row[0],'message':'已取消归档；业务记录保留，过期空间和旧登录凭据仍然过期。'}
            if row[0]>time.time():raise HTTPException(409,'只能归档已过期的演示空间，当前使用中的空间不受影响')
            if not receipt:
                at=time.time();db.execute('INSERT INTO workspace_archives VALUES(?,?,?)',(id,user['id'],at));receipt=(user['id'],at)
                db.execute('INSERT INTO workspace_archive_history VALUES(?,?,?,?,?)',(secrets.token_hex(16),id,user['id'],'archive',at))
            return {'archived':True,'workspaceId':id,'expiresAt':row[0],'actor':receipt[0],'archivedAt':receipt[1],'message':'已归档过期演示空间；原业务数据保留，可撤销归档。'}
    def child(self,token):
        if len(token)>100:raise HTTPException(401,'演示空间无效')
        key=hashlib.sha256(token.encode()).hexdigest()
        with self.lock:
            with connect(self.path) as db:
                db.execute('BEGIN IMMEDIATE')
                row=db.execute('SELECT w.expires,s.last_seen FROM workspaces w LEFT JOIN workspace_activity s ON s.id=w.id WHERE w.id=? AND NOT EXISTS (SELECT 1 FROM workspace_archives a WHERE a.id=w.id)',(key,)).fetchone()
                now=time.time()
                if not row or row[0]<now:raise HTTPException(401,'演示空间已过期，请从登录页重新进入')
                if (row[1] is None or row[1]<=now-self.idle_seconds) and self.active_count(db,now)>=20:
                    raise HTTPException(429,'当前同时使用的演示空间已达20个，请稍后重试；原数据仍保留')
                if row[1] is None or row[1]<=now-30:
                    db.execute('INSERT OR REPLACE INTO workspace_activity(id,last_seen) VALUES(?,?)',(key,now))
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
            now=time.time()
            if now-self.last_cleanup>=60:
                db.execute('BEGIN IMMEDIATE')
                expired=db.execute('SELECT w.id FROM workspaces w WHERE expires<=? AND NOT EXISTS (SELECT 1 FROM workspace_archives a WHERE a.id=w.id)',(now,)).fetchall()
                for (id,) in expired:
                    db.execute('INSERT OR IGNORE INTO workspace_archives VALUES(?,?,?)',(id,'system-expired-cleanup',now))
                    db.execute('INSERT INTO workspace_archive_history VALUES(?,?,?,?,?)',(secrets.token_hex(16),id,'system-expired-cleanup','archive',now))
                self.last_cleanup=now
            valid={r[0] for r in db.execute('SELECT w.id FROM workspaces w JOIN workspace_activity s ON s.id=w.id WHERE w.expires>? AND s.last_seen>? AND NOT EXISTS (SELECT 1 FROM workspace_archives a WHERE a.id=w.id)',(now,now-self.idle_seconds))}
            self.children={k:child for k,child in self.children.items() if k in valid}
        for child in list(self.children.values()):
            child.state.factory.tick();child.state.factory_demo_feed.tick()
            # Bound history and Postgres traffic in personal demonstration spaces.
            if int(time.time())%5==0:child.state.factory_analysis.record(child.state.factory.snapshot())
    async def __call__(self,scope,receive,send):
        if scope['type']!='http' or scope.get('method')=='OPTIONS' or not scope['path'].startswith('/factory'):
            return await self.app_router(scope,receive,send)
        request=Request(scope,receive=receive);path=scope['path'];token=request.headers.get('x-demo-workspace')
        try:
            if path=='/factory/auth/demo-session' and request.method=='POST':
                return await self.app_router(scope,receive,send)
            if token:
                if path.startswith('/factory/admin/workspaces'):raise HTTPException(403,'仅正式项目管理员可以管理全局演示空间')
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
                replayed=False
                async def replay():
                    nonlocal replayed
                    if not replayed:
                        replayed=True
                        return {'type':'http.request','body':body,'more_body':False}
                    return await receive()
                return await self.app_router(scope,replay,send)
            return await self.app_router(scope,receive,send)
        except HTTPException as error:return await JSONResponse({'detail':error.detail},status_code=error.status_code)(scope,receive,send)
def install_workspaces(app,store):
    manager=Workspaces(app,store.path.with_suffix('.workspaces.db'))
    app.state.workspaces=manager
    @app.post('/factory/auth/demo-session')
    def create_demo_space(request:Request):return manager.create(request.client.host if request.client else 'local')
    def official_admin(request):
        if request.headers.get('x-demo-workspace'):raise HTTPException(403,'仅正式项目管理员可以管理全局演示空间')
        user=app.state.factory_accounts.require(request,{'admin'})
        if user['id'].startswith('demo-'):raise HTTPException(403,'演示账号不能管理全局演示空间')
        return user
    @app.get('/factory/admin/workspaces')
    def list_spaces(request:Request):official_admin(request);return manager.inventory()
    @app.post('/factory/admin/workspaces/archive')
    def archive_space(command:ArchiveCommand,request:Request):
        user=official_admin(request)
        if command.confirmation!='归档过期演示空间':raise HTTPException(422,'请确认归档过期演示空间')
        return manager.archive(command.workspaceId,user)
    @app.post('/factory/admin/workspaces/restore')
    def restore_space(command:ArchiveCommand,request:Request):
        user=official_admin(request)
        if command.confirmation!='恢复归档记录':raise HTTPException(422,'请确认恢复归档记录')
        return manager.archive(command.workspaceId,user,restore=True)
    # Wrap the middleware layer without recursively dispatching the parent app.
    from starlette.middleware.base import BaseHTTPMiddleware
    class Isolation:
        def __init__(self,app):self.downstream=app
        async def __call__(self,scope,receive,send):
            manager.app_router=self.downstream
            return await manager(scope,receive,send)
    app.add_middleware(Isolation)
