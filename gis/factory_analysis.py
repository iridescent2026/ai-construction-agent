"""Local factory analysis: explicit relationships, plans, replay, work orders and meters.

Design relationships and demo meters never become verified engineering evidence.
All mutations commit to SQLite before returning success.
"""
import base64
import copy
import json
import math
import sqlite3
import threading
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from contextlib import contextmanager
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, model_validator


def stamp():
    return datetime.now(timezone.utc).isoformat()


def seconds(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()


def aware(value):
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError('时间必须带时区')
    return value


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)


class Node(Strict):
    id: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=120)
    view: str
    kind: str
    modelGroup: str | None = Field(default=None, max_length=100)


class Edge(Strict):
    source: str
    target: str
    relation: str = Field(min_length=1, max_length=80)
    verified: bool = False
    reference: str = Field(default='', max_length=500)
    reviewer: str = Field(default='', max_length=80)

    @model_validator(mode='after')
    def verified_evidence(self):
        if self.verified and (not self.reference.strip() or not self.reviewer.strip()):
            raise ValueError('确认连接必须填写图纸/台账依据和复核人')
        if self.source == self.target:
            raise ValueError('连接不能指向自身')
        return self


class Graph(Strict):
    nodes: list[Node] = Field(max_length=100)
    edges: list[Edge] = Field(max_length=300)


class WorkPlan(Strict):
    id: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=120)
    view: str
    startsAt: datetime
    endsAt: datetime
    center: list[float] = Field(min_length=2, max_length=2)
    size: list[float] = Field(min_length=2, max_length=2)
    kind: str = Field(default='检修', max_length=30)
    source: str = 'manual'

    @model_validator(mode='after')
    def validate_plan(self):
        aware(self.startsAt); aware(self.endsAt)
        if self.endsAt <= self.startsAt:
            raise ValueError('结束时间必须晚于开始时间')
        if self.view not in ['overview', 'a', 'b'] or self.source not in ['manual', 'demo']:
            raise ValueError('工区或来源无效')
        if any(not math.isfinite(v) or abs(v) > 1000 for v in self.center) or any(not math.isfinite(v) or v <= 0 or v > 1000 for v in self.size):
            raise ValueError('范围应为有效的场景米坐标和正数尺寸')
        return self


class Plans(Strict):
    plans: list[WorkPlan] = Field(max_length=100)


class OrderCreate(Strict):
    entityId: str
    reason: str = Field(min_length=2, max_length=2000)
    actor: str = Field(min_length=1, max_length=80)
    source: Literal['manual','demo'] = 'manual'


class OrderAction(Strict):
    action: str
    expectedVersion: int = Field(ge=1)
    actor: str = Field(min_length=1, max_length=80)
    assignee: str = Field(default='', max_length=80)
    note: str = Field(default='', max_length=3000)
    image: str | None = Field(default=None, max_length=2800000)

    @model_validator(mode='after')
    def image_evidence(self):
        if not self.actor.strip():
            raise ValueError('操作人不能为空')
        if self.image:
            prefix, separator, encoded = self.image.partition(',')
            if not separator or prefix not in ['data:image/png;base64', 'data:image/jpeg;base64', 'data:image/webp;base64']:
                raise ValueError('凭证只支持 PNG/JPEG/WebP 图片')
            try:
                raw = base64.b64decode(encoded, validate=True)
            except ValueError:
                raise ValueError('凭证编码无效')
            valid = raw.startswith(b'\x89PNG\r\n\x1a\n') if 'png' in prefix else raw.startswith(b'\xff\xd8\xff') if 'jpeg' in prefix else raw.startswith(b'RIFF') and raw[8:12] == b'WEBP'
            if not valid or len(raw) > 2_000_000:
                raise ValueError('图片内容无效或超过 2 MB')
        return self


class Meter(Strict):
    id: str = Field(min_length=1, max_length=80)
    deviceId: str
    observedAt: datetime
    powerKW: float = Field(ge=0, le=1_000_000)
    running: bool | None = None
    shift: str = Field(default='未分班', min_length=1, max_length=80)
    productionDelta: float | None = Field(default=None, ge=0, le=1e9)
    source: str = 'telemetry'
    streamId: str = Field(default='primary',min_length=1,max_length=80)

    @model_validator(mode='after')
    def validate_meter(self):
        aware(self.observedAt)
        if self.observedAt.timestamp() > datetime.now(timezone.utc).timestamp()+5:
            raise ValueError('电表采集时间不能在未来')
        if self.source not in ['telemetry', 'demo']:
            raise ValueError('电表来源无效')
        return self


class Meters(Strict):
    readings: list[Meter] = Field(min_length=1, max_length=1000)


def conflicts(plans):
    results=[]
    for index, left in enumerate(plans):
        for right in plans[index+1:]:
            if left['view'] != right['view']:
                continue
            start=max(seconds(left['startsAt']), seconds(right['startsAt']))
            end=min(seconds(left['endsAt']), seconds(right['endsAt']))
            dx=min(left['center'][0]+left['size'][0]/2,right['center'][0]+right['size'][0]/2)-max(left['center'][0]-left['size'][0]/2,right['center'][0]-right['size'][0]/2)
            dz=min(left['center'][1]+left['size'][1]/2,right['center'][1]+right['size'][1]/2)-max(left['center'][1]-left['size'][1]/2,right['center'][1]-right['size'][1]/2)
            if end>start and dx>0 and dz>0:
                results.append({'plans':[left['id'],right['id']], 'titles':[left['title'],right['title']],
                    'view':left['view'], 'overlapSeconds':round(end-start), 'overlapAreaM2':round(dx*dz,2),
                    'basis':'同工区矩形范围与时间交集；需人工确认，不代替作业许可',
                    'source':'demo' if 'demo' in [left['source'],right['source']] else 'manual'})
    return results


def energy_summary(readings, now=None):
    groups={}
    timeline={}
    for row in readings:
        channel=row.get('streamId','primary')
        groups.setdefault((row['deviceId'],row['source'],channel,row['shift']),[]).append(row)
        timeline.setdefault((row['deviceId'],row['source'],channel),[]).append(row)
    ranks={row['id']:index for rows in timeline.values() for index,row in enumerate(sorted(rows,key=lambda r:seconds(r['observedAt'])))}
    results=[]
    clock=(now or datetime.now(timezone.utc)).timestamp()
    for (device,source,channel,shift), rows in groups.items():
        rows.sort(key=lambda r:seconds(r['observedAt']))
        energy=idle=coverage=missing=idle_known=0
        for left,right in zip(rows, rows[1:]):
            dt=seconds(right['observedAt'])-seconds(left['observedAt'])
            if 0<dt<=120 and ranks[right['id']]==ranks[left['id']]+1:
                kwh=(left['powerKW']+right['powerKW'])/2*dt/3600
                energy+=kwh;coverage+=dt
                if left['running'] is not None and right['running'] is not None:
                    idle_known+=dt
                if left['running'] is False and right['running'] is False:
                    idle+=kwh
            elif dt>120 or ranks[right['id']]!=ranks[left['id']]+1:
                missing+=dt
        production=sum(r.get('productionDelta') or 0 for r in rows)
        results.append({'deviceId':device,'source':source,'streamId':channel,'shift':shift,'samples':len(rows),
            'estimatedKWh':round(energy,5) if coverage else None,'idleEstimatedKWh':round(idle,5) if idle_known else None,
            'idleCoverageSeconds':idle_known,'idleUnknownSeconds':coverage-idle_known,
            'coverageSeconds':coverage,'missingSeconds':missing,'production':production or None,
            'kWhPerUnit':round(energy/production,5) if coverage and production else None,
            'latestAt':rows[-1]['observedAt'],'fresh':-5<=clock-seconds(rows[-1]['observedAt'])<=120,
            'basis':'有效功率读数梯形积分估算；间隔超过120秒不填补，班次/来源独立，不等于实测节省金额'})
    return results


class AnalysisStore:
    def __init__(self, path, factory):
        self.path=Path(path);self.path.parent.mkdir(parents=True,exist_ok=True)
        self.factory=factory;self.lock=threading.RLock();self.record_error=None
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS analysis_docs (key TEXT PRIMARY KEY,payload TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS replay_frames (id INTEGER PRIMARY KEY AUTOINCREMENT,instance TEXT,revision INTEGER,time TEXT,payload TEXT,UNIQUE(instance,revision))')
            db.execute('CREATE TABLE IF NOT EXISTS meter_readings (id TEXT PRIMARY KEY,payload TEXT NOT NULL)')
            if not db.execute("SELECT 1 FROM analysis_docs WHERE key='graph'").fetchone():
                nodes=[{'id':e['id'],'title':e['title'],'view':e['view'],'kind':e['kind']} for e in factory.snapshot()['entities']]
                edges=[]
                if factory.demo_enabled:
                    nodes.append({'id':'PIPE-B-05','title':'B 区候选关联管廊','view':'b','kind':'pipe','modelGroup':'power-pipe-and-cable-bridge'})
                    edges=[{'source':a,'target':b,'relation':r,'verified':False,'reference':'演示连接，待现场图纸复核','reviewer':''} for a,b,r in [('B-05','PIPE-B-05','候选管线关联'),('B-01','B-05','候选供电关联'),('B-05','Z007','泵组作业区域')]]
                self.put(db,'graph',{'nodes':nodes,'edges':edges})

    @contextmanager
    def connect(self):
        db=sqlite3.connect(self.path, timeout=10)
        try:
            with db:
                yield db
        finally:
            db.close()

    def get(self,db,key,default):
        row=db.execute('SELECT payload FROM analysis_docs WHERE key=?',(key,)).fetchone()
        return json.loads(row[0]) if row else copy.deepcopy(default)

    def put(self,db,key,value):
        db.execute('INSERT OR REPLACE INTO analysis_docs VALUES (?,?)',(key,json.dumps(value,ensure_ascii=False)))

    def record(self,data):
        try:
            payload=copy.deepcopy(data);payload['events']=payload.get('events',[])[:20];payload['demo']=None
            with self.lock,self.connect() as db:
                db.execute('INSERT OR IGNORE INTO replay_frames(instance,revision,time,payload) VALUES(?,?,?,?)',
                    (data['instanceId'],data['revision'],data['updatedAt'],json.dumps(payload,ensure_ascii=False)))
                db.execute('DELETE FROM replay_frames WHERE id < (SELECT MAX(id)-3599 FROM replay_frames)')
            self.record_error=None
        except (sqlite3.Error,OSError) as error:
            self.record_error='回放记录失败：'+type(error).__name__

    def replay(self):
        with self.lock,self.connect() as db:
            return [{'id':i,'time':t} for i,t in db.execute('SELECT id,time FROM replay_frames ORDER BY id')]

    def frame(self,id: int):
        with self.lock,self.connect() as db:
            row=db.execute('SELECT payload FROM replay_frames WHERE id=?',(id,)).fetchone()
            if not row:raise HTTPException(404,'历史帧已过期或不存在')
            return json.loads(row[0])

    def summary(self):
        data=self.factory.snapshot()
        with self.lock,self.connect() as db:
            graph=self.get(db,'graph',{});plans=self.get(db,'plans',[]);orders=self.get(db,'orders',[])
            meters=[json.loads(r[0]) for r in db.execute('SELECT payload FROM meter_readings')]
        counts={state:sum(o['status']==state for o in orders) for state in ['open','assigned','in_progress','pending_review','closed']}
        closed=[seconds(o['closedAt'])-seconds(o['createdAt']) for o in orders if o['status']=='closed']
        # Polling carries metadata; photos are fetched only when requested.
        for order in orders:
            if order.get('evidence'):
                evidence=order['evidence']
                evidence['imageAvailable']=bool(evidence.pop('image',None))
        return {'demoEnabled':self.factory.demo_enabled,'factoryRevision':data['revision'],'updatedAt':stamp(),'entities':[{'id':e['id'],'title':e['title'],'view':e['view'],'kind':e['kind']} for e in data['entities']],
            'graph':graph,'plans':plans,'conflicts':conflicts(plans),'orders':orders,'orderCounts':counts,
            'meanClosureSeconds':round(sum(closed)/len(closed)) if closed else None,'energy':energy_summary(meters),
            'demoFeed':self.demo_feed.status() if hasattr(self,'demo_feed') else None,
            'recordingError':self.record_error,'replayCount':len(self.replay()),'boundary':'本地演示；操作人姓名为自报，未建立账号权限。连接确认不能替代工程审查。'}

    def graph(self,value: Graph):
        data=value.model_dump();ids={n['id'] for n in data['nodes']}
        if len(ids)!=len(data['nodes']) or any(e['source'] not in ids or e['target'] not in ids for e in data['edges']):
            raise HTTPException(422,'编号重复或连接端点不存在')
        known={e['id']:e for e in self.factory.snapshot()['entities']}
        for n in data['nodes']:
            if n['view'] not in ['overview','a','b'] or n['id'] in known and (n['view']!=known[n['id']]['view'] or n['kind']!=known[n['id']]['kind']):
                raise HTTPException(422,'图节点必须与工厂台账一致')
        with self.lock,self.connect() as db:self.put(db,'graph',data)
        return {'saved':True}

    def impact(self,id: str):
        data=self.factory.snapshot()
        with self.lock,self.connect() as db:
            graph=self.get(db,'graph',{});orders=self.get(db,'orders',[])
        nodes={n['id']:n for n in graph.get('nodes',[])}
        if id not in nodes:raise HTTPException(404,'该实体尚未配置关联台账')
        seen={id};links=[]
        for _ in range(3):
            wave=set(seen)
            for e in graph['edges']:
                if e['source'] in wave or e['target'] in wave:
                    seen.update([e['source'],e['target']])
                    if e not in links:links.append(e)
        entities={e['id']:e for e in data['entities']}
        related=[{**nodes[n],'observation':entities.get(n)} for n in sorted(seen)]
        zone_ids={n for n in seen if nodes[n]['kind']=='zone'}
        people=[e for e in data['entities'] if e['kind']=='person' and e['riskState']!='unknown' and zone_ids.intersection(e.get('currentZones',[]))]
        return {'root':id,'nodes':related,'edges':links,'people':people,
            'orders':[o for o in orders if o['entityId'] in seen],
            'basis':'双向关联查询，最多三跳；候选连接不证明故障传播。区域人员只取当前有效位置。',
            'hasUnverified':any(not e['verified'] for e in links),'factoryRevision':data['revision']}

    def exposure(self):
        with self.lock,self.connect() as db:
            frames=[json.loads(row[0]) for row in db.execute('SELECT payload FROM replay_frames ORDER BY id')]
        stats={};gaps=0
        for left,right in zip(frames,frames[1:]):
            dt=seconds(right['updatedAt'])-seconds(left['updatedAt'])
            if dt<=0:continue
            if dt>5 or left['instanceId']!=right['instanceId']:
                gaps+=dt;continue
            previous={e['id']:e for e in left['entities']}
            for entity in right['entities']:
                if entity['kind']!='person':continue
                old=previous.get(entity['id']);source=entity.get('positionSource','unknown')
                if not old or old.get('positionSource')!=source:continue
                result=stats.setdefault((entity['id'],source),{'entityId':entity['id'],'source':source,'observedSeconds':0,'unknownSeconds':0,'exposureSeconds':0,'enterEvents':0})
                def fresh(e,frame):
                    try:return -5<=seconds(frame['updatedAt'])-seconds(e['positionTimestamp'])<=120 and e['riskState']!='unknown'
                    except (KeyError,ValueError,TypeError):return False
                if not fresh(old,left) or not fresh(entity,right):result['unknownSeconds']+=dt;continue
                result['observedSeconds']+=dt
                a=set(old.get('currentZones',[]));b=set(entity.get('currentZones',[]))
                if a.intersection(b):result['exposureSeconds']+=dt
                result['enterEvents']+=len(b-a)
        return {'items':[{**r,'observedSeconds':round(r['observedSeconds'],1),'unknownSeconds':round(r['unknownSeconds'],1),'exposureSeconds':round(r['exposureSeconds'],1)} for r in stats.values()],
            'recordingGapSeconds':round(gaps,1),'basis':'相邻有效记录的停留估算；超过5秒或重启断档不补造轨迹，未知区间不算安全或暴露。首帧已在区域内不计新增进入。'}

    def plans(self,value: Plans):
        items=[p.model_dump(mode='json') for p in value.plans]
        if len({p['id'] for p in items})!=len(items):raise HTTPException(422,'作业编号不能重复')
        if not self.factory.demo_enabled and any(p['source']=='demo' for p in items):raise HTTPException(403,'真实模式禁止导入演示计划')
        with self.lock,self.connect() as db:self.put(db,'plans',items)
        return {'saved':True,'conflicts':conflicts(items)}

    def create_order(self,value: OrderCreate):
        if value.source=='demo' and not self.factory.demo_enabled:raise HTTPException(403,'真实模式禁止演示工单')
        data=self.factory.snapshot();entity=next((e for e in data['entities'] if e['id']==value.entityId),None)
        if not entity:raise HTTPException(404,'未知实体')
        if not value.actor.strip():raise HTTPException(422,'创建人不能为空')
        order={'id':'WO-'+uuid.uuid4().hex[:10].upper(),'entityId':value.entityId,'reason':value.reason,
            'status':'open','version':1,'createdAt':stamp(),'assignee':None,'evidence':None,'source':value.source,
            'trigger':{'factoryRevision':data['revision'],'entity':entity,'source':'联动演示' if value.source=='demo' else '人工发起'},
            'history':[{'action':'create','actor':value.actor.strip(),'time':stamp(),'note':value.reason}]}
        with self.lock,self.connect() as db:
            db.execute('BEGIN IMMEDIATE');orders=self.get(db,'orders',[])
            if len(orders)>=500:raise HTTPException(409,'本地工单达到500条，请先归档')
            orders.append(order);self.put(db,'orders',orders)
        return order

    def action(self,id: str,command: OrderAction):
        with self.lock,self.connect() as db:
            db.execute('BEGIN IMMEDIATE');orders=self.get(db,'orders',[])
            order=next((o for o in orders if o['id']==id),None)
            if not order:raise HTTPException(404,'未知工单')
            if order['version']!=command.expectedVersion:raise HTTPException(409,'工单已被其他操作修改，请刷新后重试')
            action=command.action;state=order['status'];actor=command.actor.strip()
            if action=='assign' and state in ['open','assigned'] and command.assignee.strip():
                order.update(status='assigned',assignee=command.assignee.strip())
            elif action=='start' and state=='assigned' and actor==order['assignee']:
                order['status']='in_progress'
            elif action=='complete' and state=='in_progress' and actor==order['assignee'] and command.note.strip():
                order.update(status='pending_review',completedBy=actor,evidence={'note':command.note,'image':command.image,'time':stamp()})
            elif action=='approve' and state=='pending_review' and actor!=order.get('completedBy') and command.note.strip():
                order.update(status='closed',closedAt=stamp(),reviewedBy=actor)
            elif action=='reject' and state=='pending_review' and actor!=order.get('completedBy') and command.note.strip():
                order['status']='in_progress'
            elif action=='reopen' and state=='closed' and command.note.strip():
                order['status']='assigned';order.pop('closedAt',None)
            else:raise HTTPException(422,'状态、操作人、指派人或凭证不满足流程要求；处理人不能自审')
            order['version']+=1;order['history'].append({'action':action,'actor':actor,'time':stamp(),'note':command.note})
            self.put(db,'orders',orders)
        return order

    def order_image(self,id: str):
        with self.lock,self.connect() as db:
            order=next((o for o in self.get(db,'orders',[]) if o['id']==id),None)
        if not order:raise HTTPException(404,'未知工单')
        image=(order.get('evidence') or {}).get('image')
        if not image:raise HTTPException(404,'工单没有照片凭证')
        return {'image':image,'version':order['version']}

    def meters(self,value: Meters):
        known={e['id'] for e in self.factory.snapshot()['entities'] if e['kind']=='device'}
        rows=[r.model_dump(mode='json') for r in value.readings]
        if len({r['id'] for r in rows})!=len(rows):raise HTTPException(422,'同批电表记录编号重复')
        if any(r['deviceId'] not in known for r in rows):raise HTTPException(404,'电表绑定设备不存在')
        if not self.factory.demo_enabled and any(r['source']=='demo' for r in rows):raise HTTPException(403,'真实模式禁止演示电表')
        with self.lock,self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            existing=[json.loads(r[0]) for r in db.execute('SELECT payload FROM meter_readings')]
            captures={(r['deviceId'],r['source'],r.get('streamId','primary'),seconds(r['observedAt'])):r['id'] for r in existing}
            for row in rows:
                capture=(row['deviceId'],row['source'],row['streamId'],seconds(row['observedAt']))
                if capture in captures and captures[capture]!=row['id']:raise HTTPException(409,'同设备同来源的采集时间已存在，请复用原记录编号')
                captures[capture]=row['id']
                old=db.execute('SELECT payload FROM meter_readings WHERE id=?',(row['id'],)).fetchone()
                if old and Meter.model_validate(json.loads(old[0])).model_dump(mode='json')!=row:raise HTTPException(409,'电表编号已占用且内容不同，不能覆盖')
            db.executemany('INSERT OR IGNORE INTO meter_readings VALUES (?,?)',[(r['id'],json.dumps(r,ensure_ascii=False)) for r in rows])
            count=db.execute('SELECT COUNT(*) FROM meter_readings').fetchone()[0]
            if count>20000:raise HTTPException(409,'电表记录达到20000条，请归档后再导入')
        return {'saved':True,'received':len(rows)}


def install_analysis(app, factory):
    store=AnalysisStore(factory.path.with_suffix('.analysis.db'),factory)
    router=APIRouter(prefix='/factory/analysis',tags=['factory-analysis'])
    router.get('')(store.summary)
    router.get('/impact/{id}')(store.impact)
    router.get('/replay')(store.replay)
    router.get('/replay/{id}')(store.frame)
    router.get('/exposure')(store.exposure)
    router.post('/graph')(store.graph)
    router.post('/plans')(store.plans)
    router.post('/orders')(store.create_order)
    router.post('/orders/{id}')(store.action)
    router.get('/orders/{id}/image')(store.order_image)
    router.post('/meters')(store.meters)
    app.include_router(router);app.state.factory_analysis=store
    store.record(factory.snapshot())
    return store
