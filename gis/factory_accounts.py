"""Local accounts for prototype work orders; demo credentials are not identities."""
from gis.workflow_language import model_enabled, model_config
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
from common.database import connect as database_connect
import time
from contextlib import contextmanager
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from typing import Literal
from common.database import storage_status

DEMO_ACCOUNTS = [
    {'id': 'demo-safety', 'name': '演示安全员', 'role': 'safety', 'password': 'SafetyDemo!2026'},
    {'id': 'demo-maintenance', 'name': '演示维修员', 'role': 'maintenance', 'password': 'RepairDemo!2026'},
    {'id': 'demo-reviewer', 'name': '演示复核员', 'role': 'reviewer', 'password': 'ReviewDemo!2026'},
    {'id': 'demo-observer', 'name': '演示只读员', 'role': 'observer', 'password': 'ObserveDemo!2026'},
]
ROLES = {'safety', 'maintenance', 'reviewer', 'observer', 'collector', 'admin'}

class Login(BaseModel):
    model_config = ConfigDict(extra='forbid')
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=256)

class Profile(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str = Field(min_length=1,max_length=80)
    department: str = Field(default='',max_length=80)
    avatar: Literal['helmet','engineer','initials'] = 'helmet'
class PasswordChange(BaseModel):
    model_config = ConfigDict(extra='forbid')
    currentPassword: str = Field(min_length=1,max_length=256)
    newPassword: str = Field(min_length=12,max_length=256)
class UserCreate(Profile):
    id: str = Field(pattern=r'^[a-zA-Z0-9_-]{3,60}$')
    role: Literal['safety','maintenance','reviewer','observer','collector','admin']
    password: str = Field(min_length=12,max_length=256)
class UserAccess(BaseModel):
    model_config=ConfigDict(extra='forbid')
    role: Literal['safety','maintenance','reviewer','observer','collector','admin']
    enabled: bool
class Accounts:
    def __init__(self, path, demo, sandbox=False):
        self.path = path
        self.sandbox = sandbox
        self.project = "个人演示空间" if sandbox else os.getenv("PROJECT_NAME","工安智瞳 A/B 项目")
        self.demo_enabled = demo
        supplied = os.getenv('FACTORY_ACCOUNTS_JSON')
        accounts = json.loads(supplied) if supplied and not sandbox else [dict(x) for x in DEMO_ACCOUNTS] if demo else []
        if sandbox: accounts.append({'id':'demo-admin','name':'演示管理员','role':'admin','password':'AdminDemo!2026'})
        if not sandbox and os.getenv('FACTORY_ADMIN_PASSWORD'): accounts.append({'id':'project-admin','name':'项目管理员','role':'admin','password':os.environ['FACTORY_ADMIN_PASSWORD']})
        self.demo_credentials = bool(demo and (sandbox or not supplied))
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT, role TEXT, salt TEXT, digest TEXT, demo INTEGER)')
            db.execute('CREATE TABLE IF NOT EXISTS sessions (digest TEXT PRIMARY KEY, user_id TEXT, expires REAL)')
            db.execute('CREATE TABLE IF NOT EXISTS failures (id TEXT PRIMARY KEY, count INTEGER, since REAL)')
            db.execute('CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY,payload TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS account_audit (id TEXT PRIMARY KEY,payload TEXT NOT NULL)')
            if not demo:
                db.execute('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE demo=1)')
                db.execute('DELETE FROM users WHERE demo=1')
            for user in accounts:
                if user['role'] not in ROLES or len(user['password']) < 12 or not user['id'].strip():
                    raise ValueError('账号角色无效或密码不足12位')
                old = db.execute('SELECT salt,digest,name,role,demo FROM users WHERE id=?', (user['id'],)).fetchone()
                if old:
                    continue
                salt = secrets.token_hex(16)
                db.execute('INSERT OR REPLACE INTO users VALUES(?,?,?,?,?,?)', (user['id'], user['name'], user['role'], salt, self.hash_password(user['password'], salt), int(sandbox or user['id'].startswith('demo-'))))
                db.execute('DELETE FROM sessions WHERE user_id=?', (user['id'],))

    @contextmanager
    def connect(self):
        db = database_connect(self.path, timeout=10)
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def hash_password(password, salt):
        return hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 260000).hex()

    @staticmethod
    def public(row):
        return dict(zip(('id', 'name', 'role'), row[:3]))

    def login(self, command):
        now = time.time()
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            failed = db.execute('SELECT count,since FROM failures WHERE id=?', (command.username,)).fetchone()
            if failed and now - failed[1] < 300 and failed[0] >= 10:
                raise HTTPException(429, '登录失败次数过多，五分钟后再试')
            row = db.execute('SELECT id,name,role,salt,digest FROM users WHERE id=?', (command.username,)).fetchone()
            valid = hmac.compare_digest(self.hash_password(command.password, row[3] if row else '00'*16), row[4] if row else '0'*64)
            if not row or not valid:
                count, since = (failed[0]+1, failed[1]) if failed and now-failed[1]<300 else (1, now)
                db.execute('INSERT OR REPLACE INTO failures VALUES(?,?,?)', (command.username, count, since))
                db.execute('DELETE FROM failures WHERE since < ?', (now-300,))
                db.commit()
                raise HTTPException(401, '账号或密码错误')
            db.execute('DELETE FROM failures WHERE id=?', (command.username,))
            db.execute('DELETE FROM sessions WHERE expires<?', (now,))
            token = secrets.token_urlsafe(32)
            db.execute('INSERT INTO sessions VALUES(?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), row[0], now+3600))
            profile=self.profile(db,row[0])
            if not profile.get('enabled',True):raise HTTPException(403,'账号已停用')
            self.audit(db,row[0],'login',row[0])
            return {'token': token, 'expiresAt': now+3600, 'user': {**self.public(row),**profile,'project':self.project}, 'demoAccounts': self.demo_credentials}

    def require(self, request, roles=None):
        header = request.headers.get('authorization', '')
        if not header.startswith('Bearer '):
            raise HTTPException(401, '请先登录操作账号')
        digest = hashlib.sha256(header[7:].encode()).hexdigest()
        with self.connect() as db:
            row = db.execute('SELECT u.id,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.digest=? AND s.expires>?', (digest, time.time())).fetchone()
        if not row:
            raise HTTPException(401, '登录已过期，请重新登录')
        user = self.public(row)
        with self.connect() as db: profile=self.profile(db,user['id'])
        if not profile.get('enabled',True):raise HTTPException(403,'账号已停用，请联系管理员')
        user.update(profile,project=self.project)
        if roles and user['role'] not in {*roles, 'admin'}:
            raise HTTPException(403, '当前账号没有此操作权限')
        return user

    def user(self, id):
        with self.connect() as db:
            row = db.execute('SELECT id,name,role FROM users WHERE id=?', (id,)).fetchone()
        if not row:return None
        with self.connect() as db:profile=self.profile(db,id)
        return {**self.public(row),**profile,'project':self.project} if profile.get('enabled',True) else None

    def profile(self,db,id):
        row=db.execute('SELECT payload FROM profiles WHERE id=?',(id,)).fetchone()
        return json.loads(row[0]) if row else {'department':'','avatar':'helmet','enabled':True}
    def audit(self,db,actor,action,target):
        import uuid
        row={'actor':actor,'action':action,'target':target,'at':time.time()}
        db.execute('INSERT INTO account_audit VALUES(?,?)',(uuid.uuid4().hex,json.dumps(row,ensure_ascii=False)))
    def install(self, app):
        router = APIRouter(prefix='/factory/auth', tags=['factory-accounts'])
        @router.post('/login')
        def login(command: Login):
            return self.login(command)
        @router.get('/me')
        def me(request: Request):
            return self.require(request)
        @router.get('/users')
        def users(request: Request):
            self.require(request)
            with self.connect() as db:
                return [{**self.public(row),**self.profile(db,row[0])} for row in db.execute('SELECT id,name,role FROM users ORDER BY id') if self.profile(db,row[0]).get('enabled',True)]
        @router.get('/mode')
        def mode():
            return {'demoAccounts': self.demo_credentials, 'simulationEnabled':self.demo_enabled,'accountsConfigured': self.has_accounts(),'project':self.project,'storage':storage_status(),'language':{'configured':model_enabled(),'model':model_config()['model']}}
        @router.post('/logout')
        def logout(request: Request):
            self.require(request)
            digest = hashlib.sha256(request.headers['authorization'][7:].encode()).hexdigest()
            with self.connect() as db:
                db.execute('DELETE FROM sessions WHERE digest=?', (digest,))
            return {'loggedOut': True}
        @router.post('/profile')
        def profile(value:Profile,request:Request):
            user=self.require(request)
            with self.connect() as db:
                old=self.profile(db,user['id']);old.update(value.model_dump(exclude={'name'}))
                db.execute('UPDATE users SET name=? WHERE id=?',(value.name,user['id']))
                db.execute('INSERT OR REPLACE INTO profiles VALUES(?,?)',(user['id'],json.dumps(old,ensure_ascii=False)))
                self.audit(db,user['id'],'profile',user['id'])
            return self.require(request)
        @router.post('/password')
        def password(value:PasswordChange,request:Request):
            user=self.require(request)
            if value.newPassword==value.currentPassword:raise HTTPException(422,'新密码不能与原密码相同')
            with self.connect() as db:
                row=db.execute('SELECT salt,digest FROM users WHERE id=?',(user['id'],)).fetchone()
                if not hmac.compare_digest(self.hash_password(value.currentPassword,row[0]),row[1]):raise HTTPException(403,'原密码不正确')
                salt=secrets.token_hex(16)
                db.execute('UPDATE users SET salt=?,digest=? WHERE id=?',(salt,self.hash_password(value.newPassword,salt),user['id']))
                db.execute('DELETE FROM sessions WHERE user_id=?',(user['id'],));self.audit(db,user['id'],'password_changed',user['id'])
            return {'loggedOut':True,'message':'密码已更新，所有旧会话已退出，请重新登录'}
        @router.get('/manage')
        def manage(request:Request):
            self.require(request,{'admin'})
            with self.connect() as db:return [{**self.public(row),**self.profile(db,row[0]),'project':self.project} for row in db.execute('SELECT id,name,role FROM users ORDER BY id')]
        @router.post('/manage')
        def create(value:UserCreate,request:Request):
            user=self.require(request,{'admin'});salt=secrets.token_hex(16)
            with self.connect() as db:
                db.execute('BEGIN IMMEDIATE')
                if db.execute('SELECT COUNT(*) FROM users').fetchone()[0]>=200:raise HTTPException(429,'本项目账号已达200个，请先归档')
                if db.execute('SELECT 1 FROM users WHERE id=?',(value.id,)).fetchone():raise HTTPException(409,'账号编号已存在')
                db.execute('INSERT INTO users VALUES(?,?,?,?,?,?)',(value.id,value.name,value.role,salt,self.hash_password(value.password,salt),int(self.sandbox)))
                db.execute('INSERT INTO profiles VALUES(?,?)',(value.id,json.dumps({'department':value.department,'avatar':value.avatar,'enabled':True},ensure_ascii=False)))
                self.audit(db,user['id'],'create',value.id)
            return {'id':value.id,'name':value.name,'role':value.role,'project':self.project}
        @router.post('/manage/{id}')
        def access(id:str,value:UserAccess,request:Request):
            user=self.require(request,{'admin'})
            if id==user['id']:raise HTTPException(409,'不能在此修改自己的角色或停用自己')
            with self.connect() as db:
                if not db.execute('SELECT 1 FROM users WHERE id=?',(id,)).fetchone():raise HTTPException(404,'账号不存在')
                old=self.profile(db,id);old['enabled']=value.enabled
                db.execute('UPDATE users SET role=? WHERE id=?',(value.role,id))
                db.execute('INSERT OR REPLACE INTO profiles VALUES(?,?)',(id,json.dumps(old)))
                db.execute('DELETE FROM sessions WHERE user_id=?',(id,));self.audit(db,user['id'],'access_changed',id)
            return {'updated':True}
        @router.get('/audit')
        def audit(request:Request):
            self.require(request,{'admin'})
            with self.connect() as db:return [json.loads(row[0]) for row in db.execute('SELECT payload FROM account_audit')][-200:]
        app.include_router(router)

    def has_accounts(self):
        with self.connect() as db:
            return bool(db.execute('SELECT 1 FROM users LIMIT 1').fetchone())
