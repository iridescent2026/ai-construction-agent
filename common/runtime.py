import os
from datetime import datetime, timezone
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse

FRESH_SECONDS = 120


def is_fresh(record, now=None):
    try:
        if not isinstance(record.get('timestamp'), str):
            return False
        timestamp = datetime.fromisoformat(record['timestamp'].replace('Z','+00:00'))
        age = ((now or datetime.now(timezone.utc)) - timestamp).total_seconds()
        return 0 <= age <= FRESH_SECONDS
    except (KeyError, TypeError, ValueError):
        return False


def allowed_origins():
    return os.getenv('ALLOWED_ORIGINS','http://127.0.0.1:8080,http://localhost:8080,http://127.0.0.1:18080,http://localhost:18080').split(',')


def configure_api(app):
    origins = allowed_origins()
    app.add_middleware(CORSMiddleware,allow_origins=origins,allow_methods=['GET','POST','OPTIONS'],allow_headers=['Content-Type'])

    @app.middleware('http')
    async def origin_guard(request,call_next):
        # CORS alone does not prevent simple cross-origin POST side effects.
        origin=request.headers.get('origin')
        if origin and origin not in origins:
            return JSONResponse({'detail':'不允许此网页来源访问本地接口'},status_code=403)
        return await call_next(request)

    @app.get('/health')
    def health():
        return {'status':'ok','mode':'local-demo'}
