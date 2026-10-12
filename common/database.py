"""SQLite locally; private PostgreSQL schemas when DATABASE_URL is configured."""
import os, re, hashlib, sqlite3, threading
from pathlib import Path
_pool = None
_lock = threading.RLock()
_ready = set()
class PostgreSQL:
    def __init__(self, path):
        global _pool
        from psycopg_pool import ConnectionPool
        with _lock:
            if _pool is None:
                _pool = ConnectionPool(os.environ['DATABASE_URL'], min_size=1, max_size=4, timeout=15,
                    kwargs={'autocommit':True,'prepare_threshold':None,'connect_timeout':10,'sslmode':'require'})
        self.db = _pool.getconn()
        self.schema = 'gzt_' + hashlib.sha256(Path(path).name.encode()).hexdigest()[:20]
        try:
            with _lock:
                if self.schema not in _ready:
                    self.db.execute(f'CREATE SCHEMA IF NOT EXISTS "{self.schema}"')
                    _ready.add(self.schema)
            self.db.execute(f'SET search_path TO "{self.schema}"')
            self.db.autocommit=False
        except Exception:
            _pool.putconn(self.db);raise
    def execute(self, sql, parameters=()):
        if sql.strip().upper() in ('BEGIN','BEGIN IMMEDIATE'):
            # psycopg starts a transaction on first statement; writes acquire a
            # schema advisory lock so read/modify/write cycles stay atomic.
            if 'IMMEDIATE' in sql.upper():
                self.db.execute('SELECT pg_advisory_xact_lock(hashtext(%s))',(self.schema,))
            return self.db.execute('SELECT 1')
        original=sql
        replace=bool(re.match(r'INSERT OR REPLACE',sql,re.I));ignore=bool(re.match(r'INSERT OR IGNORE',sql,re.I))
        sql=re.sub(r'INSERT OR (?:REPLACE|IGNORE)', 'INSERT', sql, flags=re.I)
        sql=sql.replace('?', '%s')
        sql=re.sub(r'INTEGER PRIMARY KEY AUTOINCREMENT','BIGSERIAL PRIMARY KEY',sql,flags=re.I)
        sql=re.sub(r'\bREAL\b','DOUBLE PRECISION',sql,flags=re.I)
        if ignore:sql+=' ON CONFLICT DO NOTHING'
        if replace:
            table=re.search(r'INTO\s+(\w+)',sql,re.I).group(1)
            columns=[r[0] for r in self.db.execute('SELECT column_name FROM information_schema.columns WHERE table_schema=%s AND table_name=%s ORDER BY ordinal_position',(self.schema,table))]
            pk={'analysis_docs':'key','metadata':'key'}.get(table,'id')
            updates=','.join(f'"{c}"=EXCLUDED."{c}"' for c in columns if c!=pk)
            sql+=f' ON CONFLICT ("{pk}") DO UPDATE SET '+updates
        return self.db.execute(sql,parameters)
    def commit(self):self.db.commit()
    def rollback(self):self.db.rollback()
    def close(self):
        if self.db is not None:
            self.db.rollback();self.db.autocommit=True;self.db.execute('RESET search_path');_pool.putconn(self.db);self.db=None
    def __enter__(self):return self
    def __exit__(self,kind,value,tb):
        try:self.rollback() if kind else self.commit()
        finally:self.close()
def connect(path, **kwargs):
    if os.getenv('DATABASE_URL'):return PostgreSQL(path)
    return sqlite3.connect(path, **kwargs)
def storage_status():
    return {'backend':'postgresql' if os.getenv('DATABASE_URL') else 'sqlite',
            'durable':bool(os.getenv('DATABASE_URL') or os.getenv('PERSISTENT_DISK','0')=='1'),
            'note':'外部数据库已配置；需完成重启恢复验证' if os.getenv('DATABASE_URL') else '本地数据库；免费云实例新增记录会在重启时丢失'}
