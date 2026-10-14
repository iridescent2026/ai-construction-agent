"""Load migrated math service with an isolated in-memory test log."""
import importlib.util, os
from pathlib import Path
keys=('AGENT_DB_PATH','DEEPSEEK_API_KEY')
saved={k:os.environ.get(k) for k in keys}
try:
    os.environ['AGENT_DB_PATH']=':memory:'
    os.environ['DEEPSEEK_API_KEY']=''
    spec=importlib.util.spec_from_file_location('math_branch_updates',Path(__file__).resolve().parents[1]/'math/main.py')
    agent=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(agent)
finally:
    for key,value in saved.items():
        if value is None:os.environ.pop(key,None)
        else:os.environ[key]=value
