"""Persistent application-wide model budget, shared by all demo workspaces."""
import hashlib
import os
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from common.database import connect


class QuotaLimit(ValueError):
    pass


class ModelQuota:
    def __init__(self, path=None):
        default = Path(os.getenv('GIS_DB_PATH', str(Path(__file__).with_name('data.db')))).with_suffix('.model-quota.db')
        self.path = Path(path or os.getenv('WORKFLOW_QUOTA_DB_PATH', str(default)))
        if not os.getenv('DATABASE_URL'):
            self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.execute('CREATE TABLE IF NOT EXISTS model_usage (id TEXT PRIMARY KEY,scope TEXT NOT NULL,at DOUBLE PRECISION NOT NULL)')
            db.execute('CREATE INDEX IF NOT EXISTS model_usage_time ON model_usage(at)')
            db.execute('CREATE INDEX IF NOT EXISTS model_usage_scope_time ON model_usage(scope,at)')

    @contextmanager
    def connection(self):
        db = connect(self.path)
        try:
            with db:
                yield db
        finally:
            db.close()

    def acquire(self, scope, now=None):
        now = time.time() if now is None else now
        day_start = int(now // 86400) * 86400
        limit = max(0, int(os.getenv('WORKFLOW_MODEL_DAILY_LIMIT', '100')))
        scope = hashlib.sha256(scope.encode()).hexdigest()
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            # Keep the current and previous UTC day. Count attempts, including
            # failed provider calls; restart cannot restore spent allowance.
            db.execute('DELETE FROM model_usage WHERE at < ?', (day_start - 86400,))
            used = db.execute('SELECT COUNT(*) FROM model_usage WHERE at>=? AND at<?', (day_start, day_start + 86400)).fetchone()[0]
            if used >= limit:
                raise QuotaLimit('本项目 UTC 当日模型调用额度已用完，已使用本地工具')
            recent = db.execute('SELECT COUNT(*) FROM model_usage WHERE scope=? AND at>?', (scope, now - 60)).fetchone()[0]
            if recent >= 6:
                raise QuotaLimit('当前空间一分钟模型调用已达六次，已使用本地工具')
            db.execute('INSERT INTO model_usage VALUES(?,?,?)', (uuid.uuid4().hex, scope, now))

    def status(self, now=None):
        now = time.time() if now is None else now
        start = int(now // 86400) * 86400
        limit = max(0, int(os.getenv('WORKFLOW_MODEL_DAILY_LIMIT', '100')))
        with self.connection() as db:
            used = db.execute('SELECT COUNT(*) FROM model_usage WHERE at>=? AND at<?', (start, start + 86400)).fetchone()[0]
        return {'utcDay': time.strftime('%Y-%m-%d', time.gmtime(now)), 'used': used,
                'limit': limit, 'remaining': max(0, limit - used), 'persistent': True,
                'boundary': '应用级调用尝试额度，所有空间共用；失败调用也计数。不是模型供应商账户的账单硬上限。'}
