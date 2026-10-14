"""Evidence-bound device investigation. Tool orchestration never operates machinery."""
import copy
import hashlib
import json
import re
import time
import uuid
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from common.runtime import is_fresh
from gis.factory_analysis import OrderCreate, OrderAction, WorkPlan, conflicts, seconds
from gis.factory_business import SCENARIO, evaluate_registered, maintenance_check

class Chat(BaseModel):
    model_config = ConfigDict(extra='forbid')
    query: str = Field(min_length=1, max_length=2000)
    entityId: str = 'B-05'
    useTestRule: bool = False

class DraftRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    entityId: str = 'B-05'
    useTestRule: bool = False
    reason: str = Field(default='核对设备观测、候选连接及关联区域作业，记录现场核查结果。', min_length=2, max_length=2000)
    maintenancePlan: WorkPlan | None = None

class Confirm(BaseModel):
    model_config = ConfigDict(extra='forbid')
    assignee: str = Field(min_length=1, max_length=80)

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()

def source_label(entity, field):
    source = entity.get(field+'Source', 'unknown')
    provenance = entity.get(field+'Provenance', {})
    if source == 'demo':return '后台模拟'
    if provenance.get('kind') == 'manual':return '手动测试导入'
    if provenance.get('kind') == 'authenticated_import':return '采集账号导入（设备真实性未核验）'
    return '旧接口记录（采集身份未核验）' if source == 'telemetry' else '未接入'

class Workflow:
    def __init__(self, factory, analysis, accounts):
        self.factory, self.analysis, self.accounts = factory, analysis, accounts
        with analysis.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS investigation_drafts (id TEXT PRIMARY KEY,owner TEXT,expires REAL,payload TEXT,order_id TEXT)')

    def context(self):
        snapshot = self.factory.snapshot()
        with self.analysis.lock, self.analysis.connect() as db:
            db.execute('BEGIN')
            documents = {k:self.analysis.get(db,k,{} if k=='graph' else SCENARIO if k=='businessScenario' else []) for k in ('graph','plans','orders','businessRules','businessScenario')}
        return snapshot, documents

    def case(self, id='B-05', use_test=False, context=None):
        if use_test and not self.factory.demo_enabled:
            raise HTTPException(403, '真实模式禁止流程测试规则')
        data, docs = context or self.context()
        entity = next((e for e in data['entities'] if e['id']==id and e['kind']=='device'), None)
        if not entity:raise HTTPException(404, '工厂台账中没有此设备')
        clock = datetime.now(timezone.utc)
        trace = []
        def tool(name, operation):
            start=time.perf_counter();result=operation()
            trace.append({'tool':name,'input':{'entityId':id},'status':'success','factoryRevision':data['revision'],'elapsedMs':round((time.perf_counter()-start)*1000,2),'output':copy.deepcopy(result)})
            return result
        def observation():
            fresh = is_fresh({'timestamp':entity.get('measurementTimestamp')}, clock)
            values=entity.get('measurements', {})
            rule={'id':None,'version':None,'status':'待核验','basis':'尚无设备适用规则，不据此判断正常或故障'}
            status='pending' if fresh and values else 'unknown'
            if use_test:
                rule={'id':'FLOW-TEST-TEMP','version':'1','status':'设计假设','basis':'60℃仅用于验证软件分支，不是泵组工程限值','metric':'temperature','unit':'℃','threshold':60}
                temperature=values.get('temperature')
                status=('test_alert' if temperature['value']>=60 else 'test_clear') if fresh and temperature and temperature['unit']=='℃' else 'unknown'
            registered=evaluate_registered(entity,docs.get('businessRules',[]),fresh,use_test,clock.timestamp())
            if registered: status,rule=registered['status'],registered['rule']
            names={'pending':'待核验','unknown':'观测缺失或过期，状态未知','test_alert':'触发流程测试条件，待人工核查','test_clear':'未触发流程测试条件，不能证明设备安全','registered_alert':'单项触发已录入规则，待人工核查','registered_clear':'未触发已录入规则，不能证明设备安全'}
            missing=['flow'] if '泵' in entity['title'] and 'flow' not in values else []
            return {'id':id,'title':entity['title'],'view':entity['view'],'measurements':copy.deepcopy(values),'observedAt':entity.get('measurementTimestamp'),'source':source_label(entity,'measurement'),'provenance':entity.get('measurementProvenance'), 'fresh':fresh,'status':status,'statusLabel':names[status],'rule':rule,'ruleChecks':registered['checks'] if registered else [],'missingMeasurements':missing,'missingNote':'流量未接入，不生成估算值' if missing else ''}
        obs=tool('get_device_observation', observation)
        def impact_query():
            if not any(n['id']==id for n in docs['graph'].get('nodes',[])):
                return {'root':id,'nodes':[],'edges':[],'people':[],'orders':[],'hasUnverified':True,'basis':'未配置连接台账，影响范围待核验','factoryRevision':data['revision']}
            result=self.analysis.impact_context(id,data,docs['graph'],docs['orders'])
            result['orders']=[{'id':o['id'],'entityId':o['entityId'],'status':o['status'],'assignee':o['assignee']} for o in result['orders']]
            return result
        impact=tool('query_relationships', impact_query)
        zone_ids={n['id'] for n in impact['nodes'] if n['kind']=='zone'}
        zones=[e for e in data['entities'] if e['id'] in zone_ids and e['kind']=='zone']
        def inside(person,zone):
            return person['view']==zone['view'] and abs(person['anchor'][0]-zone['center'][0])<=zone['size'][0]/2 and abs(person['anchor'][2]-zone['center'][1])<=zone['size'][1]/2
        def personnel():
            known,unknown=[],[]
            for person in data['entities']:
                if person['kind']!='person' or person['view']!=entity['view']:continue
                item={'id':person['id'],'title':person['title'],'role':person.get('role'),'observedAt':person.get('positionTimestamp'),'source':source_label(person,'position')}
                if not is_fresh({'timestamp':person.get('positionTimestamp')},clock):unknown.append(item)
                else:
                    hits=[z['id'] for z in zones if inside(person,z)]
                    if hits:known.append({**item,'zones':hits,'anchor':person['anchor'],'restrictionAlarm':bool(set(hits).intersection(person.get('currentZones',[])))})
            return {'valid':known,'unknownInWorkArea':unknown,'basis':'仅核对关联区域的有效位置；同工区未知人员单列，不能据此排除人员影响'}
        people=tool('query_area_personnel', personnel)
        def plans():
            related=[p for p in docs['plans'] if p['view']==entity['view'] and seconds(p['endsAt'])>=clock.timestamp() and any(
                abs(p['center'][0]-z['center'][0])<(p['size'][0]+z['size'][0])/2 and abs(p['center'][1]-z['center'][1])<(p['size'][1]+z['size'][1])/2 for z in zones)]
            return {'items':[{**p,'timeState':'进行中' if seconds(p['startsAt'])<=clock.timestamp() else '计划中'} for p in related], 'conflicts':conflicts(related),'configuredCount':len(docs['plans']),'basis':'同工区矩形与时间交集；无计划或无匹配记录不代表没有现场作业'}
        work=tool('query_work_plans',plans)
        orders=tool('query_work_orders',lambda:[{'id':o['id'],'status':o['status'],'version':o['version'],'assignee':o['assignee'],'source':o['source']} for o in docs['orders'] if o['entityId']==id])
        scenario=docs.get('businessScenario',SCENARIO)
        recommendations=[
            {'step':'核对观测', 'reason':obs['statusLabel']+'；'+obs['source'], 'action':'先补采样并核对时间、单位、读数来源' if obs['status']=='unknown' else '核对现场仪表、适用设备手册与观测出处', 'role':'安全员 / 设备责任人'},
            {'step':'核对关联', 'reason':impact['basis'], 'action':'先复核候选供电、管线与区域连接；未核验前不宣称故障传播', 'role':'工程复核岗位'},
            {'step':'核对人员与作业', 'reason':f'有效相关人员 {len(people["valid"])}，同工区位置未知 {len(people["unknownInWorkArea"])}，已录入作业重叠 {len(work["conflicts"])}', 'action':'更新未知位置，并填写拟检修的时段与范围再检查冲突', 'role':'安全员 / 作业协调岗位'},
            {'step':'确认处置边界', 'reason':'系统没有远程设备控制，也没有正式作业许可审批', 'action':'核查工单不授权停机、断电、隔离或维修；这些操作须由具备现场权限的人员按现场规程执行', 'role':'现场授权岗位'},
            {'step':'提交与复核', 'reason':f'该设备工单 {len(orders)} 张', 'action':'安全员确认核查工单，被指派账号提交凭证，另一复核账号关闭或退回', 'role':'维修员 → 复核员'},
        ]
        evidence = {'observation':obs['status'],'source':obs['source'],'graph':docs['graph'],'plans':docs['plans'],'instance':data['instanceId'],'rules':docs.get('businessRules',[]),'scenario':scenario}
        return {'entityId':id,'factoryRevision':data['revision'],'instanceId':data['instanceId'],'capturedAt':clock.isoformat(),'observation':obs,'impact':impact,'people':people,'workPlans':work,'orders':orders,'toolResults':trace,'evidenceKey':digest(evidence),'useTestRule':use_test,
            'ledger':[{'field':'设备编号、名称、工区','status':'已知','basis':'当前项目台账，非现场核验'}, {'field':'连接与影响范围','status':'待核验' if impact['hasUnverified'] else '已填写复核依据','basis':impact['basis']}, {'field':'设备适用规则','status':obs['rule']['status'],'basis':obs['rule']['basis']}, {'field':'观测来源','status':'已知','basis':obs['source']}, {'field':'真实业务岗位与作业计划','status':'待核验','basis':'演示账号与计划不代表企业组织或现场许可'}],
            'scenario':scenario,'recommendations':recommendations,
            'nextSteps':['核对采集来源、设备手册及现场读数','核对候选连接和相关作业计划','由安全员确认核查工单并指派维修账号','处理凭证由另一个复核账号审核'], 'boundary':'规则工具编排；不诊断故障原因、不控制设备、不代替工程审查。'}

    def draft(self, command, user):
        case=self.case(command.entityId,command.useTestRule)
        if command.maintenancePlan:
            data,docs=self.context()
            case=self.case(command.entityId,command.useTestRule,(data,docs))
            entity=next(e for e in data['entities'] if e['id']==command.entityId)
            case['maintenanceCheck']=maintenance_check(entity,command.maintenancePlan,docs['plans'])
        value={'id':'DRAFT-'+uuid.uuid4().hex[:12].upper(),'entityId':command.entityId,'reason':command.reason,'recommendedRole':'maintenance','createdBy':user['id'],'createdAt':case['capturedAt'],'expiresAt':time.time()+300,'status':'awaiting_confirmation','case':case}
        with self.analysis.lock,self.analysis.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('DELETE FROM investigation_drafts WHERE expires<? AND order_id IS NULL',(time.time(),))
            if db.execute('SELECT COUNT(*) FROM investigation_drafts WHERE order_id IS NULL').fetchone()[0]>=200:raise HTTPException(409,'未确认草案过多，请等待过期或完成确认')
            db.execute('INSERT INTO investigation_drafts VALUES(?,?,?,?,NULL)',(value['id'],user['id'],value['expiresAt'],json.dumps(value,ensure_ascii=False)))
        return value

    def confirm(self,id,command,user):
        assigned=self.accounts.user(command.assignee)
        if not assigned or assigned['role']!='maintenance':raise HTTPException(422,'请选择有效维修账号')
        with self.factory.lock,self.analysis.lock,self.analysis.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute('SELECT owner,expires,payload,order_id FROM investigation_drafts WHERE id=?',(id,)).fetchone()
            if not row:raise HTTPException(404,'草案不存在')
            if row[0]!=user['id']:raise HTTPException(403,'只能确认自己创建的草案')
            if row[3]:
                order=next(o for o in self.analysis.get(db,'orders',[]) if o['id']==row[3])
                return {'order':order,'alreadyConfirmed':True}
            if row[1]<time.time():raise HTTPException(409,'草案已过期，请重新查询并生成')
            draft=json.loads(row[2]);data=self.factory.snapshot()
            docs={k:self.analysis.get(db,k,{} if k=='graph' else SCENARIO if k=='businessScenario' else []) for k in ('graph','plans','orders','businessRules','businessScenario')}
            latest=self.case(draft['entityId'],draft['case']['useTestRule'],(data,docs))
            if latest['evidenceKey']!=draft['case']['evidenceKey']:raise HTTPException(409,'数据有效性、来源、规则判定或台账已变化，请重新生成草案')
            plan=draft['case'].get('maintenanceCheck',{}).get('plan')
            if plan:
                entity=next(e for e in data['entities'] if e['id']==draft['entityId'])
                checked=maintenance_check(entity,plan,docs['plans'])
                if checked['blocked']:raise HTTPException(409,'检修候选计划与已有作业冲突，请调整后重新生成草案')
                latest['maintenanceCheck']=checked
            context={'snapshot':data,'case':{'reviewed':draft['case'],'confirmed':latest,'draftId':id,'maintenancePlan':plan}}
            order=self.analysis.create_order(OrderCreate(entityId=draft['entityId'],reason=draft['reason'],actor=user['id'],source='demo' if latest['useTestRule'] or next(e for e in data['entities'] if e['id']==draft['entityId']).get('measurementSource')=='demo' else 'manual'),context,db)
            order=self.analysis.action(order['id'],OrderAction(action='assign',actor=user['id'],assignee=command.assignee,expectedVersion=1,note='已确认核查草案；尚未执行现场处理'),db)
            if plan:self.analysis.put(db,'plans',[*docs['plans'],plan])
            db.execute('UPDATE investigation_drafts SET order_id=? WHERE id=?',(order['id'],id))
            return {'order':order,'alreadyConfirmed':False}

    def chat(self,command,request):
        query=command.query.strip()
        if not query:raise HTTPException(422,'问题不能为空')
        from gis.workflow_language import interpret
        import os
        if os.getenv('WORKFLOW_MODEL_ENABLED','0')=='1':self.accounts.require(request)
        parsed=interpret(query,command.entityId,str(self.accounts.path),devices=self.factory.snapshot()['entities']);id=parsed['entityId'];intent=parsed['intent']
        if parsed['clarification']:
            traces=[{**parsed['trace'],'input':{'query':query}}] if parsed['trace'] else []
            return {'success':False,'needsInput':True,'answer':parsed['clarification'],'tool_calls':[t['tool'] for t in traces],'tool_results':traces,'engine':'rule-tool-orchestrator','languageEngine':parsed['engine']}
        case=self.case(id,command.useTestRule);obs=case['observation'];draft=None
        if intent=='status':
            labels={'temperature':'温度','pressure':'压力','voltage':'电压','current':'电流','leakage':'漏电','load':'负荷','speed':'速度','flow':'流量'}
            readings='、'.join(f'{labels.get(k,k)} {m["value"]}{m["unit"]}' for k,m in obs['measurements'].items()) or '没有测量读数'
            captured=obs['observedAt'] or '未接入'
            if obs['observedAt']:
                try:captured=datetime.fromisoformat(obs['observedAt'].replace('Z','+00:00')).astimezone(timezone(timedelta(hours=8))).strftime('%Y-%m-%d %H:%M:%S（北京时间）')
                except (ValueError,TypeError):pass
            answer=f'{id} · {obs["title"]}\n当前状态：{obs["statusLabel"]}。\n监测读数：{readings}。\n数据来源：{obs["source"]}；采集时间：{captured}。\n判断依据：{obs["rule"]["basis"]}。'
            if obs['missingNote']:answer+='\n'+obs['missingNote']+'。'
        elif intent=='impact':
            answer='候选关联：'+('、'.join(n['id']+' '+n['title'] for n in case['impact']['nodes'] if n['id']!=id) or '暂无连接台账')+'。'+case['impact']['basis']+('包含未确认连接，不能认定故障传播。' if case['impact']['hasUnverified'] else '填写依据不等于工程因果验证。')
        elif intent=='people':
            answer=f'关联区域有效人员：'+('、'.join(p['id']+' '+p['title'] for p in case['people']['valid']) or '未发现有效记录')+f'；同工区位置未知 {len(case["people"]["unknownInWorkArea"])} 人。相关作业 {len(case["workPlans"]["items"])} 项、范围时段重叠 {len(case["workPlans"]["conflicts"])} 组；未匹配计划不代表没有现场作业。'
            if '冲突' in query:answer+='拟检修尚未指定时段和范围，不能判断这次检修是否冲突；请在“候选检修计划”中填写后检查。'
        elif intent=='recommendations':
            answer='\n'.join(f'{index+1}. {r["step"]}：{r["action"]}。依据：{r["reason"]}；责任岗位：{r["role"]}。' for index,r in enumerate(case['recommendations']))
        elif intent=='responsibility':
            answer='工单与处理账号：'+('；'.join(f'{r["id"]} / {r["status"]} / 指派 {r["assignee"] or "未指派"}' for r in case['orders']) or '该设备还没有已录入工单，不能指定实际责任人')+'。核查依据在本次工具记录，凭证与操作历史在维修闭环；实际组织职责仍待核实。'
        elif intent=='draft':
            user=self.accounts.require(request,{'safety'})
            draft=self.draft(DraftRequest(entityId=id,useTestRule=command.useTestRule),user)
            case=draft['case']
            case['toolResults'].append({'tool':'prepare_investigation_draft','input':{'entityId':id},'output':{'draftId':draft['id'],'status':draft['status']},'status':'success','factoryRevision':case['factoryRevision']})
            answer=f'已生成核查草案 {draft["id"]}，尚未创建或指派工单。请核对依据、选择维修账号，再点击确认。'
        else:answer='安全员确认并指派 → 被指派维修账号开始处理 → 提交核查凭证 → 另一复核账号审核关闭；支持退回。聊天不能直接关闭工单，关闭工单不会自动解除仍存在的报警。'
        if parsed['trace']:
            case['toolResults'].insert(0,{**parsed['trace'],'input':{'query':query},'factoryRevision':case['factoryRevision']})
        extra=[]
        for other in parsed['intents']:
            if other==intent:continue
            if other=='status':extra.append('观测：'+obs['statusLabel']+'；来源 '+obs['source']+'；采集 '+str(obs['observedAt'])+'；依据 '+obs['rule']['basis'])
            elif other=='impact':extra.append('关联：'+('、'.join(n['id'] for n in case['impact']['nodes']) or '暂无台账')+'；'+case['impact']['basis'])
            elif other=='people':extra.append('人员与作业：有效相关人员 '+str(len(case['people']['valid']))+'，同工区未知位置 '+str(len(case['people']['unknownInWorkArea']))+'；相关计划 '+str(len(case['workPlans']['items']))+' 项。拟检修冲突需填写时段与范围后检查。')
            elif other=='responsibility':extra.append('责任：'+('；'.join(o['id']+' → '+str(o['assignee'] or '待指派') for o in case['orders']) or '尚未登记责任工单'))
            elif other=='review':extra.append('复核：处理账号提交凭证，由另一复核账号关闭或退回；不通过聊天直接关闭。')
            elif other=='recommendations':extra.append('建议：'+'；'.join(r['action'] for r in case['recommendations']))
        if extra:answer+='\n\n'+'\n'.join(extra)
        missing=['拟检修开始/结束时间','实际作业范围与高度'] if '冲突' in query else []
        return {'success':True,'intent':intent,'intents':parsed['intents'],'languageEngine':parsed['engine'],'missingInputs':missing,'entityId':id,'answer':answer,'case':case,'draft':draft,'engine':'rule-tool-orchestrator','tool_calls':[t['tool'] for t in case['toolResults']],'tool_results':case['toolResults']}

def install_workflow(app,factory,analysis,accounts):
    workflow=Workflow(factory,analysis,accounts);router=APIRouter(prefix='/factory/workflow',tags=['device-investigation'])
    @router.get('/case/{id}')
    def case(id:str,useTestRule:bool=False):return workflow.case(id,useTestRule)
    @router.post('/chat')
    def chat(command:Chat,request:Request):return workflow.chat(command,request)
    @router.post('/drafts')
    def draft(command:DraftRequest,request:Request):return workflow.draft(command,accounts.require(request,{'safety'}))
    @router.post('/drafts/{id}/confirm')
    def confirm(id:str,command:Confirm,request:Request):return workflow.confirm(id,command,accounts.require(request,{'safety'}))
    app.include_router(router);app.state.factory_workflow=workflow
