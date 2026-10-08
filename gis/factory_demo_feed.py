"""Explicit simulation feed. Never claims or overwrites live telemetry."""
import math
import sqlite3
import threading
import uuid
from datetime import datetime,timezone,timedelta
from fastapi import HTTPException
from pydantic import BaseModel
from typing import Literal
from gis.factory import DemoCommand
from gis.factory_analysis import Meters,Plans,OrderCreate,OrderAction


class FeedCommand(BaseModel):
    action: Literal['start','stop']


class DemoFeed:
    def __init__(self,factory,analysis):
        self.factory=factory;self.analysis=analysis;self.lock=threading.RLock()
        self.running=False;self.last_at=None;self.started_at=None;self.error=None
        self.run_id=None;self.samples=0;self.motion_token=None;self.devices=[]

    def status(self):
        with self.lock:
            return {'enabled':self.factory.demo_enabled,'running':self.running,'source':'demo',
                'startedAt':self.started_at,'lastSampleAt':self.last_at.isoformat() if self.last_at else None,
                'samplesThisRun':self.samples,'devices':self.devices,'error':self.error,
                'basis':'后台生成的联动模拟数据；每5秒采样，演示电表只保留近期记录。工单不会自动完工或复核。'}

    def command(self,value:FeedCommand):
        if value.action=='start':return self.start()
        return self.stop()

    def start(self,now=None):
        with self.lock:
            if not self.factory.demo_enabled:raise HTTPException(403,'真实接入模式禁止联动模拟')
            if self.running:return self.status()
            self.error=None;self.run_id=uuid.uuid4().hex[:12];self.samples=0
            clock=now or datetime.now(timezone.utc)
            snapshot=self.factory.snapshot()
            self.devices=[id for id in ['B-05','B-01','A-01'] if not any(e['id']==id and e.get('measurementSource')=='telemetry' for e in snapshot['entities'])]
            if not self.devices:raise HTTPException(409,'示例设备均有接口读数，禁止由模拟覆盖')
            self.factory.analysis_demo_enabled=True
            try:
                # Existing motion and imported positions are preserved.
                with self.factory.lock:
                    protected=any(e['id'] in ['P023','P024','P021'] and e.get('positionSource')=='telemetry' for e in self.factory.data['entities'])
                    if not self.factory.data['demo'] and not protected:
                        self.factory.command(DemoCommand(action='start',key='outdoor'))
                        self.motion_token=self.factory.data['demo']['started']
                    else:self.factory.tick()
                config=self.analysis.summary()
                plans=[p for p in config['plans'] if p['id'] not in ['DEMO-FEED-LIFT','DEMO-FEED-PASS'] or p['source']!='demo']
                for id,title,center,size,kind in [('DEMO-FEED-LIFT','联动演示：吊装隔离范围',[28,20],[20,14],'吊装'),('DEMO-FEED-PASS','联动演示：临时人员通道',[36,20],[18,4],'通行')]:
                    # Never replace a manual plan sharing the reserved sample ID.
                    if any(p['id']==id for p in plans):continue
                    plans.append({'id':id,'title':title,'view':'overview','center':center,'size':size,'kind':kind,'source':'demo',
                        'startsAt':(clock-timedelta(minutes=2)).isoformat(),'endsAt':(clock+timedelta(minutes=45)).isoformat()})
                self.analysis.plans(Plans(plans=plans))
                if 'B-05' in self.devices and not any(o.get('source')=='demo' and o['entityId']=='B-05' and o['status']!='closed' for o in config['orders']):
                    order=self.analysis.create_order(OrderCreate(entityId='B-05',reason='联动演示：泵组温升模拟，请核对候选供电和管廊连接；不代表现场故障。',actor='演示调度员',source='demo'))
                    self.analysis.action(order['id'],OrderAction(action='assign',expectedVersion=order['version'],actor='演示调度员',assignee='演示维修员',note='演示派单，处理和复核必须手动完成'))
                # Clearly demo-labelled initial samples make the energy tab usable immediately.
                recent=any(r.get('streamId')=='live-demo' and r['fresh'] and r['coverageSeconds']>0 for r in config['energy'])
                for offset in ([0] if recent else [-60,-30,0]):self.sample(clock+timedelta(seconds=offset))
                self.started_at=clock.isoformat();self.running=True
                self.analysis.record(self.factory.snapshot())
            except Exception as error:
                self.error='联动模拟启动失败：'+str(getattr(error,'detail',type(error).__name__))
                self.stop_motion();self.factory.analysis_demo_enabled=False
                raise
            return self.status()

    def stop_motion(self):
        with self.factory.lock:
            demo=self.factory.data.get('demo')
            if self.motion_token is not None and demo and demo.get('started')==self.motion_token and demo.get('key')=='outdoor':
                self.factory.command(DemoCommand(action='stop'))
        self.motion_token=None

    def stop(self):
        with self.lock:
            self.running=False;self.factory.analysis_demo_enabled=False;self.stop_motion()
            self.factory.tick();self.analysis.record(self.factory.snapshot())
            return self.status()

    def sample(self,clock):
        known={e['id']:e for e in self.factory.snapshot()['entities']}
        readings=[]
        for id in self.devices:
            if known[id].get('measurementSource')=='telemetry':continue
            phase=clock.timestamp()/10
            base={'B-05':6.0,'B-01':10.0,'A-01':7.0}[id]
            running=id!='B-05' or int(clock.timestamp()/30)%2==1
            readings.append({'id':f'feed-{self.run_id}-{self.samples}-{id}','deviceId':id,'observedAt':clock.isoformat(),
                'powerKW':round(base+math.sin(phase)*.4,3),'running':running,'shift':'联动演示班次',
                'productionDelta':2 if id=='A-01' and running else None,'source':'demo'})
            readings[-1]['streamId']='live-demo'
        if readings:
            self.analysis.meters(Meters(readings=readings))
            # Track ownership explicitly; IDs typed by users are not producer ownership.
            with self.analysis.lock,self.analysis.connect() as db:
                db.execute('CREATE TABLE IF NOT EXISTS demo_feed_readings(id TEXT PRIMARY KEY)')
                db.executemany('INSERT OR IGNORE INTO demo_feed_readings VALUES (?)',[(r['id'],) for r in readings])
                ids=[r[0] for r in db.execute('SELECT id FROM demo_feed_readings ORDER BY rowid DESC LIMIT -1 OFFSET 1800')]
                db.executemany('DELETE FROM meter_readings WHERE id=?',[(id,) for id in ids])
                db.executemany('DELETE FROM demo_feed_readings WHERE id=?',[(id,) for id in ids])
        self.last_at=clock;self.samples+=1

    def tick(self,now=None):
        with self.lock:
            if not self.running:return
            clock=now or datetime.now(timezone.utc)
            if self.last_at and (clock-self.last_at).total_seconds()<5:return
            try:self.sample(clock)
            except (sqlite3.Error,OSError,HTTPException) as error:
                self.error='模拟采样失败：'+str(getattr(error,'detail',type(error).__name__))
                self.running=False;self.factory.analysis_demo_enabled=False
