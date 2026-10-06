"""Shared factory observations for the homepage, GIS map and 3D scene.

Scene-local metres are the authoritative position coordinates. The geographic
placement is a design reference, not a surveyed site coordinate system.
"""
import asyncio
import copy
import json
import math
import os
import sqlite3
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from common.runtime import is_fresh
from gis.imagery import SITE, imagery_metadata

CATALOG = json.loads(Path(__file__).with_name('factory-catalog.json').read_text(encoding='utf-8'))
UNITS = {'temperature':'℃','load':'%','pressure':'MPa','current':'A','voltage':'kV','leakage':'mA','speed':'m/s'}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


class Measurement(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra='forbid')
    value: float
    unit: str


class Observation(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra='forbid')
    id: str
    x: float | None = Field(default=None, ge=-1000, le=1000)
    z: float | None = Field(default=None, ge=-1000, le=1000)
    measurements: dict[str, Measurement] | None = None

    @model_validator(mode='after')
    def complete(self):
        if (self.x is None) != (self.z is None):
            raise ValueError('位置必须同时提供 x 和 z')
        if self.x is None and not self.measurements:
            raise ValueError('必须提供位置或设备测量数据')
        for key, measurement in (self.measurements or {}).items():
            if key not in UNITS or measurement.unit != UNITS[key]:
                raise ValueError('测量字段或单位不匹配')
        return self


class Batch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    observations: list[Observation] = Field(min_length=1, max_length=100)

    @model_validator(mode='after')
    def unique(self):
        if len({o.id for o in self.observations}) != len(self.observations):
            raise ValueError('同批编号不能重复')
        return self


class DemoCommand(BaseModel):
    action: str
    key: str = 'overview'


class FactoryStore:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        with sqlite3.connect(self.path) as db:
            db.execute('CREATE TABLE IF NOT EXISTS factory_state (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)')
            row = db.execute('SELECT payload FROM factory_state WHERE id=1').fetchone()
        self.data = json.loads(row[0]) if row else {'revision':0,'entities':copy.deepcopy(CATALOG['entities']),'events':[],'active':[],'sequence':0,'demo':None}
        self.data['demo'] = None
        self.started = time.monotonic()
        self.tick()

    def save(self):
        self.data['revision'] += 1
        self.data['updatedAt'] = now_iso()
        with sqlite3.connect(self.path) as db:
            db.execute('INSERT OR REPLACE INTO factory_state VALUES(1,?)', (json.dumps(self.data, ensure_ascii=False),))

    def evaluate(self):
        entities = self.data['entities']
        zones = [e for e in entities if e['kind']=='zone']
        active=[]
        for e in entities:
            if e['kind']!='person' and not e.get('mobile'):
                continue
            previous=e.get('currentZones',[])
            fresh=is_fresh({'timestamp':e.get('positionTimestamp')})
            hits=[z['id'] for z in zones if z['view']==e['view'] and abs(e['anchor'][0]-z['center'][0])<=z['size'][0]/2 and abs(e['anchor'][2]-z['center'][1])<=z['size'][1]/2 and z['id'] not in e.get('allowedZones',[])] if fresh else previous
            e['riskState']='unknown' if not fresh else 'danger' if hits else 'clear'
            for kind, ids in [('enter',set(hits)-set(previous)),('leave',set(previous)-set(hits))]:
                for zone_id in sorted(ids):
                    self.data['sequence']+=1
                    self.data['events'].insert(0,{'id':self.data['sequence'],'type':kind,'entityId':e['id'],'title':e['title'],'zoneId':zone_id,'view':e['view'],'time':int(time.time()*1000),'source':e.get('positionSource','unknown')})
            e['currentZones']=hits
            for zone_id in hits:
                zone=next(z for z in zones if z['id']==zone_id)
                entered=next((r['time'] for r in self.data['events'] if r['entityId']==e['id'] and r['zoneId']==zone_id and r['type']=='enter'),int(time.time()*1000))
                active.append({'id':f"{e['id']}:{zone_id}",'entityId':e['id'],'title':e['title'],'kind':e['kind'],'view':e['view'],'zoneId':zone_id,'zoneTitle':zone['title'],'state':e['riskState'],'time':entered,'source':e.get('positionSource','unknown')})
        self.data['active']=active
        self.data['events']=self.data['events'][:100]

    def tick(self):
        with self.lock:
            timestamp=now_iso()
            seconds=time.monotonic()-self.started
            demo=self.data.get('demo')
            for index,e in enumerate(self.data['entities']):
                if e['kind']=='person' or e.get('mobile'):
                    if e.get('positionSource')!='telemetry':
                        e['positionSource']='demo'
                        e['positionTimestamp']=timestamp
                if e['kind']=='device' and e.get('measurementSource')!='telemetry':
                    value=round(35+3*math.sin(seconds/8+index),1)
                    if any(word in e['title'] for word in ['泵','阀门','储气','压力']):
                        measurements={'pressure':{'value':round(.48+.04*math.sin(seconds/7+index),3),'unit':'MPa'},'temperature':{'value':value,'unit':'℃'}}
                    elif '10kV' in e['title'] or '变压器' in e['title']:
                        measurements={'voltage':{'value':round(10+.02*math.sin(seconds/8),2),'unit':'kV'},'temperature':{'value':value,'unit':'℃'}}
                    elif '配电箱' in e['title']:
                        measurements={'current':{'value':round(25+math.sin(seconds/8)*2,1),'unit':'A'},'leakage':{'value':round(.08+.01*math.sin(seconds/8),3),'unit':'mA'}}
                    else:
                        measurements={'load':{'value':round(40+3*math.sin(seconds/8+index),1),'unit':'%'},'temperature':{'value':value,'unit':'℃'}}
                    e.update(measurements=measurements,measurementSource='demo',measurementTimestamp=timestamp)
            if demo:
                path=CATALOG['paths'][demo['key']]
                e=next(e for e in self.data['entities'] if e['id']==path['id'])
                phase=((time.monotonic()-demo['started'])%24)/12
                segment=(phase if phase<=1 else 2-phase)*(len(path['points'])-1)
                index=min(len(path['points'])-2,math.floor(segment));fraction=segment-index
                point=[a+(b-a)*fraction for a,b in zip(path['points'][index],path['points'][index+1])]
                e['anchor'][0],e['anchor'][2]=point
            self.evaluate()
            self.save()

    def snapshot(self):
        with self.lock:
            data=copy.deepcopy(self.data)
            if data['demo']:
                data['demo'].pop('started',None)
            data['coordinateSystem']={'origin':SITE['center'],'description':'公开厂区参考锚点，业务点位未现场配准；x 向东、z 向南，单位米','frames':{'overview':[0,0,1],'a':[-28,-19,.85],'b':[39,-28,.55]}}
            data['site']=copy.deepcopy(SITE)
            return data

    def observe(self, batch):
        with self.lock:
            by_id={e['id']:e for e in self.data['entities']}
            # Validate the entire batch before any mutation.
            for o in batch.observations:
                e=by_id.get(o.id)
                if not e or e['kind']=='zone':
                    raise HTTPException(404,f'未知实体编号 {o.id}')
                if o.x is not None and e['kind']!='person' and not e.get('mobile'):
                    raise HTTPException(422,'固定设备不能更新移动位置')
                if o.measurements and e['kind']!='device':
                    raise HTTPException(422,'测量数据只能绑定设备')
            timestamp=now_iso()
            for o in batch.observations:
                e=by_id[o.id]
                if o.x is not None:
                    e['anchor'][0],e['anchor'][2]=o.x,o.z
                    e.update(positionTimestamp=timestamp,positionSource='telemetry')
                    if self.data['demo'] and CATALOG['paths'][self.data['demo']['key']]['id']==o.id:
                        self.data['demo']=None
                if o.measurements:
                    e.update(measurements={k:m.model_dump() for k,m in o.measurements.items()},measurementTimestamp=timestamp,measurementSource='telemetry')
            self.evaluate();self.save()
            return self.snapshot()

    def command(self, command):
        with self.lock:
            if command.action=='start':
                if command.key not in CATALOG['paths']:
                    raise HTTPException(422,'未知移动路线')
                path=CATALOG['paths'][command.key]
                e=next(e for e in self.data['entities'] if e['id']==path['id'])
                if e.get('positionSource')=='telemetry':
                    raise HTTPException(409,'该实体已接入现场位置，不能用演示覆盖')
                self.data['demo']={'key':command.key,'id':path['id'],'started':time.monotonic()}
            elif command.action in ['stop','reset']:
                self.data['demo']=None
                if command.action=='reset':
                    for e in self.data['entities']:
                        if e.get('origin') and e.get('positionSource')!='telemetry':
                            e['anchor'][0],e['anchor'][2]=e['origin']
            else:
                raise HTTPException(422,'未知演示操作')
            self.tick()
            return self.snapshot()


def install_factory(app):
    default=Path(os.getenv('GIS_DB_PATH',str(Path(__file__).with_name('data.db')))).with_suffix('.factory.db')
    store=FactoryStore(os.getenv('FACTORY_DB_PATH',str(default)))
    router=APIRouter(prefix='/factory',tags=['factory'])

    @router.get('/state')
    def state():
        return store.snapshot()

    @router.get('/imagery-metadata')
    def metadata(refresh:bool=False):
        return imagery_metadata(refresh)

    @router.post('/observations')
    def observations(batch:Batch):
        return store.observe(batch)

    @router.post('/demo')
    def demo(command:DemoCommand):
        return store.command(command)

    async def sampler():
        while True:
            await asyncio.sleep(1)
            await asyncio.to_thread(store.tick)

    previous_lifespan=app.router.lifespan_context

    @asynccontextmanager
    async def lifespan(application):
        async with previous_lifespan(application):
            task=asyncio.create_task(sampler())
            app.state.factory_sampler=task
            try:
                yield
            finally:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

    app.router.lifespan_context=lifespan

    app.include_router(router)
    app.state.factory=store
