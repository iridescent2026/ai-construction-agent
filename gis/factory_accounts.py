"""Local accounts for prototype work orders; demo credentials are not identities."""
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
from contextlib import contextmanager
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

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

class Accounts:
    def __init__(self, path, demo):
        self.path = path
        self.demo_enabled = demo
        supplied = os.getenv('FACTORY_ACCOUNTS_JSON')
        accounts = json.loads(supplied) if supplied else DEMO_ACCOUNTS if demo else []
        self.demo_credentials = bool(demo and not supplied)
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT, role TEXT, salt TEXT, digest TEXT, demo INTEGER)')
            db.execute('CREATE TABLE IF NOT EXISTS sessions (digest TEXT PRIMARY KEY, user_id TEXT, expires REAL)')
            db.execute('CREATE TABLE IF NOT EXISTS failures (id TEXT PRIMARY KEY, count INTEGER, since REAL)')
            if not demo:
                db.execute('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE demo=1)')
                db.execute('DELETE FROM users WHERE demo=1')
            for user in accounts:
                if user['role'] not in ROLES or len(user['password']) < 12 or not user['id'].strip():
                    raise ValueError('账号角色无效或密码不足12位')
                old = db.execute('SELECT salt,digest,name,role,demo FROM users WHERE id=?', (user['id'],)).fetchone()
                if old and hmac.compare_digest(self.hash_password(user['password'], old[0]), old[1]) and old[2:] == (user['name'], user['role'], int(self.demo_credentials)):
                    continue
                salt = secrets.token_hex(16)
                db.execute('INSERT OR REPLACE INTO users VALUES(?,?,?,?,?,?)', (user['id'], user['name'], user['role'], salt, self.hash_password(user['password'], salt), int(self.demo_credentials)))
                db.execute('DELETE FROM sessions WHERE user_id=?', (user['id'],))

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
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
            return {'token': token, 'expiresAt': now+3600, 'user': self.public(row), 'demoAccounts': self.demo_credentials}

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
        if roles and user['role'] not in {*roles, 'admin'}:
            raise HTTPException(403, '当前账号没有此操作权限')
        return user

    def user(self, id):
        with self.connect() as db:
            row = db.execute('SELECT id,name,role FROM users WHERE id=?', (id,)).fetchone()
        return self.public(row) if row else None

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
                return [self.public(row) for row in db.execute('SELECT id,name,role FROM users ORDER BY id')]
        @router.get('/mode')
        def mode():
            return {'demoAccounts': self.demo_credentials, 'simulationEnabled':self.demo_enabled,'accountsConfigured': self.has_accounts()}
        @router.post('/logout')
        def logout(request: Request):
            self.require(request)
            digest = hashlib.sha256(request.headers['authorization'][7:].encode()).hexdigest()
            with self.connect() as db:
                db.execute('DELETE FROM sessions WHERE digest=?', (digest,))
            return {'loggedOut': True}
        app.include_router(router)

    def has_accounts(self):
        with self.connect() as db:
            return bool(db.execute('SELECT 1 FROM users LIMIT 1').fetchone())
