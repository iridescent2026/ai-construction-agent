"""Personal tasks, review records and reversible data backup, scoped to a project."""
import copy, hashlib, json, uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from typing import Literal
from common.database import storage_status
from gis.factory_business import SCENARIO
from gis.factory_analysis import Graph, WorkPlan, Meter
class ReviewRecord(BaseModel):
    model_config=ConfigDict(extra='forbid')
    subject: Literal['equipment','connections','rules','positions','responsibility']
    conclusion: Literal['confirmed','revision_required','unverifiable']
    reference: str = Field(min_length=5,max_length=2000)
    qualification: str = Field(min_length=2,max_length=500)
    note: str = Field(min_length=5,max_length=3000)
class Restore(BaseModel):
    model_config=ConfigDict(extra='forbid')
    backup: dict
    expectedRevision: int = Field(ge=0)
    confirmation: Literal['恢复本项目备份']
def checksum(value):return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def install_operations(app,factory,analysis,accounts):
    router=APIRouter(prefix='/factory/operations',tags=['personal-operations'])
    runtime_id=uuid.uuid4().hex
    @router.get('/storage-proof')
    def storage_proof(request:Request):
        accounts.require(request,{'admin'})
        with analysis.connect() as db:proof=analysis.get(db,'storageProof',None)
        return {'storage':storage_status(),'proof':proof,'retainedAfterRestart':bool(proof and proof['runtimeId']!=runtime_id),'boundary':'验证记录留存，不代表工程数据真实性。'}
    @router.post('/storage-proof')
    def create_storage_proof(request:Request):
        user=accounts.require(request,{'admin'})
        with analysis.lock,analysis.connect() as db:
            db.execute('BEGIN IMMEDIATE');proof=analysis.get(db,'storageProof',None)
            if not proof:
                proof={'id':uuid.uuid4().hex,'actor':user['id'],'createdAt':datetime.now(timezone.utc).isoformat(),'runtimeId':runtime_id}
                analysis.put(db,'storageProof',proof)
        return {'proof':proof,'retainedAfterRestart':proof['runtimeId']!=runtime_id,'storage':storage_status()}
    def documents(db):return {key:analysis.get(db,key,SCENARIO if key=='businessScenario' else {} if key=='graph' else []) for key in ['graph','plans','orders','businessRules','businessScenario','engineeringReviews']}
    def export():
        with factory.lock,analysis.lock,analysis.connect() as db:
            value={'format':'gongan-zhitong-backup','version':1,'project':accounts.project,'createdAt':datetime.now(timezone.utc).isoformat(),'factory':copy.deepcopy(factory.data),'documents':documents(db),'meters':[json.loads(r[0]) for r in db.execute('SELECT payload FROM meter_readings')],'experiments':[{'id':r[0],'owner':r[1],'payload':json.loads(r[2])} for r in db.execute('SELECT id,owner,payload FROM prototype_runs')]}
        value['factory']['demo']=None
        value['checksum']=checksum(value);return value
    @router.get('/tasks')
    def tasks(request:Request):
        user=accounts.require(request);data=factory.snapshot()
        with analysis.connect() as db:docs=documents(db)
        orders=docs['orders'];mine=[o for o in orders if (o.get('assignee')==user['id'] and o['status']!='closed') or (user['role'] in ('reviewer','admin') and o['status']=='pending_review') or (user['role']=='safety' and o['status'] in ('draft','open'))]
        latest={r['subject']:r for r in sorted(docs['engineeringReviews'],key=lambda r:r['at']) if r['scope']=='recorded_review'}
        pending=5-sum(r['conclusion']=='confirmed' for r in latest.values())
        return {'user':user,'revision':data['revision'],'orders':mine,'pendingReview':sum(o['status']=='pending_review' for o in mine),'assigned':len(mine),'alarms':len(data['active']),'unknown':sum(e.get('riskState')=='unknown' for e in data['entities'] if e['kind']=='person'),'evidencePending':pending,'reviews':docs['engineeringReviews'],'storage':storage_status(),'next':'先核对观测与依据，再确认工单；处理和复核由不同岗位账号完成'}
    @router.get('/reviews')
    def reviews(request:Request):
        accounts.require(request)
        with analysis.connect() as db:return {'items':analysis.get(db,'engineeringReviews',[]),'subjects':{'equipment':'设备用途与铭牌','connections':'连接台账与图号','rules':'适用阈值、工况与文件版本','positions':'测点、定位与坐标配准','responsibility':'岗位职责、许可与验收'},'boundary':'记录审阅人的声明及材料；系统不能核实资质或文件真实性。演示账号只记原型审阅。'}
    @router.post('/reviews')
    def review(value:ReviewRecord,request:Request):
        user=accounts.require(request,{'reviewer'});row={**value.model_dump(),'id':uuid.uuid4().hex,'reviewer':user['id'],'at':datetime.now(timezone.utc).isoformat(),'scope':'prototype' if accounts.sandbox or user['id'].startswith('demo-') else 'recorded_review'}
        with analysis.lock,analysis.connect() as db:
            db.execute('BEGIN IMMEDIATE');items=analysis.get(db,'engineeringReviews',[])
            if len(items)>=500:raise HTTPException(409,'审阅记录已达上限，请导出归档')
            analysis.put(db,'engineeringReviews',[*items,row])
        return row
    @router.get('/experiment-summary')
    def experiment_summary(request:Request):
        import statistics
        accounts.require(request,{'admin','reviewer'})
        with analysis.connect() as db:rows=[json.loads(r[0]) for r in db.execute('SELECT payload FROM prototype_runs')]
        from gis.experiment_statistics import summarize
        eligible=[r for r in rows if r.get('participantDeclaration') and not r.get('restoredFromBackup') and not r['owner'].startswith('demo-')]
        metrics=summarize(eligible);finished=[r for r in eligible if r['status']=='finished'];participants={r['owner'] for r in eligible}
        return {'declaredParticipants':len(participants),'finishedRuns':len(finished),'fullyCorrect':sum(r['score']==4 for r in finished),
                'pairs':metrics['correctPairs'],'medianSavedSeconds':metrics['medianCorrectPairsSavedSeconds'],**metrics,
                'excludedPracticeOrImported':len(rows)-len(eligible),'readyForPrototypeComparison':metrics['completeParticipants']>=3,
                'boundary':'仅统计声明本人完成的独立非演示账号，身份与操作由组织者核对。至少3人各完成4题两种方法；同时报告错误、未完成和实际顺序，不把答对样本的时间差当作整体效果。'}
    @router.get('/model-usage')
    def model_usage(request:Request):
        accounts.require(request,{'admin'})
        from gis.model_quota import ModelQuota
        return ModelQuota().status()
    @router.get('/backup')
    def backup(request:Request):accounts.require(request,{'admin'});return export()
    @router.post('/restore')
    def restore(value:Restore,request:Request):
        user=accounts.require(request,{'admin'});content=copy.deepcopy(value.backup);claimed=content.pop('checksum',None)
        if content.get('format')!='gongan-zhitong-backup' or content.get('version')!=1 or claimed!=checksum(content):raise HTTPException(422,'备份格式或校验值不正确')
        if content.get('project')!=accounts.project:raise HTTPException(422,'只能恢复本项目备份')
        # Business backup restoration preserves current identity/session records.
        from pydantic import ValidationError
        docs=content.get('documents',{})
        try:
            Graph.model_validate(docs['graph']);[WorkPlan.model_validate(p) for p in docs.get('plans',[])]
            if len(docs.get('orders',[]))>500 or len(content.get('meters',[]))>20000 or len(content.get('experiments',[]))>2000:raise ValueError('Too many records')
            valid_ids={e['id'] for e in factory.data['entities'] if e['kind']=='device'}
            for order in docs.get('orders',[]):
                if not all(k in order for k in ('id','entityId','reason','status','version','history','assignee','source')) or order['entityId'] not in valid_ids or order['status'] not in ['open','assigned','in_progress','pending_review','closed'] or not isinstance(order['history'],list):raise ValueError('Invalid work order')
            for m in content.get('meters',[]):
                Meter.model_validate(m)
                if m['deviceId'] not in valid_ids:raise ValueError('Unknown meter device')
            for r in docs.get('engineeringReviews',[]):
                ReviewRecord.model_validate({k:r[k] for k in ReviewRecord.model_fields})
                if not isinstance(r['at'],str):raise ValueError('Invalid review time')
            for e in content.get('experiments',[]):
                r=e['payload']
                if not isinstance(e['id'],str) or e['owner']!=r['owner'] or e['id']!=r['id'] or r['status'] not in ('running','finished') or r['method'] not in ('manual','system') or r['task']['id'] not in ('fresh_alert','stale','no_trigger','missing'):raise ValueError('Invalid experiment')
                if r['status']=='finished' and (r['score'] not in range(5) or not isinstance(r['durationSeconds'],(float,int)) or r['durationSeconds']<0):raise ValueError('Invalid experiment result')
        except (ValidationError,ValueError,KeyError,TypeError):raise HTTPException(422,'备份业务内容校验失败，未恢复任何记录')
        if any(not isinstance(v,list) for k,v in docs.items() if k not in ('graph','businessScenario')):raise HTTPException(422,'备份文档结构无效')
        # A checksum detects corruption, not authorship. Imported evidence must
        # never impersonate a signed-in reviewer or measured human experiment.
        for edge in docs['graph'].get('edges',[]):
            if edge.get('verified'):edge.update(verified=False,reviewScope='pending',reviewedAt=None)
        for r in docs.get('engineeringReviews',[]):r['scope']='imported_review'
        for r in docs.get('businessRules',[]):
            if r.get('status')=='review_recorded':r.update(status='submitted',reviewer=None)
        if docs.get('businessScenario',{}).get('status')=='review_recorded':docs['businessScenario'].update(status='submitted',reviewer=None)
        for e in content.get('experiments',[]):e['payload']['restoredFromBackup']=True
        before=export()
        with factory.lock,analysis.lock,analysis.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if factory.data['revision']!=value.expectedRevision:raise HTTPException(409,'观测版本已变化，请重新导出当前备份后重试')
            analysis.put(db,'beforeRestore',before)
            for key,item in docs.items():
                if key not in ['graph','plans','orders','businessRules','businessScenario','engineeringReviews']:raise HTTPException(422,'备份含未允许的文档')
                analysis.put(db,key,item)
            db.execute('DELETE FROM meter_readings')
            for m in content.get('meters',[]):db.execute('INSERT INTO meter_readings VALUES(?,?)',(m['id'],json.dumps(m,ensure_ascii=False)))
            db.execute('DELETE FROM prototype_runs')
            for e in content.get('experiments',[]):db.execute('INSERT INTO prototype_runs VALUES(?,?,?)',(e['id'],e['owner'],json.dumps(e['payload'],ensure_ascii=False)))
            analysis.put(db,'lastRestore',{'actor':user['id'],'at':datetime.now(timezone.utc).isoformat(),'checksum':claimed})
        return {'restored':True,'message':'业务台账、工单和实验已恢复；导入复核依据须重新审阅，导入实验不计新人机对比成效。现场位置与读数需重新采集；账号和密码保持当前设置。'}
    @router.get('/before-restore')
    def before_restore(request:Request):
        accounts.require(request,{'admin'})
        with analysis.connect() as db:return analysis.get(db,'beforeRestore',None)
    app.include_router(router)
