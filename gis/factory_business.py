"""Recorded business evidence and prototype experiments; never certify site safety."""
import copy
import json
import statistics
import time
import uuid
from datetime import datetime, timezone
from typing import Literal
from fastapi import APIRouter, HTTPException, Request
from pydantic import Field, model_validator
from gis.factory_analysis import Strict, WorkPlan, conflicts, seconds, stamp, aware

SCENARIO = {
    'id': 'MOD-SUPPORT-B05', 'version': 1, 'status': 'design_assumption',
    'title': '模块化建筑生产厂房 · 辅助排水设备核查',
    'description': '把现有 B-05 候选映射到生产厂房辅助排水设备。核查异常读数是否涉及供电、管线、人员及检修时段；实际设备用途、工艺和岗位待核验。',
    'reference': '', 'author': 'prototype-design', 'history': [],
    'boundary': '这是业务设计假设，不是企业案例；泵组失效对建筑质量、生产或排水的具体后果尚未确认。',
}

class ScenarioProposal(Strict):
    expectedVersion: int = Field(ge=1)
    title: str = Field(min_length=2, max_length=120)
    description: str = Field(min_length=10, max_length=2000)
    reference: str = Field(default='', max_length=1000)

class RuleProposal(Strict):
    entityId: str = 'B-05'
    metric: str = Field(min_length=1, max_length=50)
    unit: str = Field(min_length=1, max_length=30)
    operator: Literal['gte', 'lte']
    threshold: float
    effectiveFrom: datetime
    effectiveUntil: datetime
    purpose: Literal['software_test', 'documented']
    reference: str = Field(min_length=5, max_length=1000)
    response: str = Field(min_length=5, max_length=1000)

    @model_validator(mode='after')
    def valid_time(self):
        aware(self.effectiveFrom); aware(self.effectiveUntil)
        if self.effectiveUntil <= self.effectiveFrom:
            raise ValueError('规则有效期结束必须晚于开始')
        return self

class EvidenceReview(Strict):
    expectedVersion: int = Field(ge=1)
    decision: Literal['approve', 'reject']
    qualification: str = Field(min_length=2, max_length=200)
    note: str = Field(min_length=5, max_length=1000)

class MaintenanceRequest(Strict):
    entityId: str = 'B-05'
    plan: WorkPlan

def maintenance_check(entity, plan, plans, now=None, exclude_id=None):
    row = plan.model_dump(mode='json') if isinstance(plan, WorkPlan) else copy.deepcopy(plan)
    if row['view'] != entity['view']:
        raise HTTPException(422, '检修范围必须使用设备所在工区坐标')
    if row['source'] != 'manual':
        raise HTTPException(422, '检修候选计划需标记为手动测试计划')
    if any(abs(entity['anchor'][axis]-row['center'][index])>row['size'][index]/2 for index,axis in enumerate((0,2))):
        raise HTTPException(422, '检修范围必须包含设备在当前模型中的位置，不能把范围移到别处绕过冲突')
    if seconds(row['endsAt']) <= (now or time.time()):
        raise HTTPException(409, '检修候选计划已过期')
    peers = [p for p in plans if p['id'] != exclude_id]
    if any(p['id'] == row['id'] for p in peers):
        raise HTTPException(409, '候选计划编号已存在，请更换编号')
    matches = [c for c in conflicts([row, *peers]) if row['id'] in c['plans']]
    return {'plan': row, 'conflicts': matches, 'blocked': bool(matches),
            'basis': '同工区矩形与时间交集；有冲突不允许确认安排，无交集不代表获得现场作业许可。',
            'nextStep': '调整时段或范围后重新核查' if matches else '核对现场隔离、许可及相关岗位后，由安全员确认核查工单'}

def evaluate_registered(entity, rules, fresh, use_test, now):
    relevant = [r for r in rules if r['entityId'] == entity['id']]
    applicable = [r for r in relevant if r['status'] in ('prototype_reviewed', 'review_recorded')
                  and seconds(r['effectiveFrom']) <= now < seconds(r['effectiveUntil'])
                  and (r['status'] == 'review_recorded' and r['purpose'] == 'documented' or use_test)]
    if not applicable:
        return None
    checks = []
    for rule in applicable:
        reading = entity.get('measurements', {}).get(rule['metric'])
        valid = fresh and reading and reading['unit'] == rule['unit']
        triggered = bool(valid and (reading['value'] >= rule['threshold'] if rule['operator'] == 'gte' else reading['value'] <= rule['threshold']))
        checks.append({'id': rule['id'], 'version': rule['version'], 'metric': rule['metric'],
                       'value': reading['value'] if reading else None, 'unit': rule['unit'],
                       'operator': rule['operator'], 'threshold': rule['threshold'],
                       'result': 'triggered' if triggered else 'not_triggered' if valid else 'unknown',
                       'reference': rule['reference'], 'reviewer': rule['reviewer'],
                       'scope': rule['status'], 'response': rule['response']})
    status = 'registered_alert' if any(c['result'] == 'triggered' for c in checks) else 'unknown' if any(c['result'] == 'unknown' for c in checks) else 'registered_clear'
    return {'status': status, 'checks': checks,
            'rule': {'id': 'REGISTERED-RULES', 'version': ','.join(c['id']+':'+str(c['version']) for c in checks),
                     'status': '复核记录' if all(c['scope'] == 'review_recorded' for c in checks) else '原型复核',
                     'basis': '按已录入且有效的规则逐项判断，单项触发优先；来源与现场适用性仍须核实，未触发不能证明设备安全'}}

class RunStart(Strict):
    taskId: Literal['fresh_alert', 'stale', 'no_trigger', 'missing']
    method: Literal['manual', 'system']

class RunFinish(Strict):
    observation: Literal['triggered', 'unknown', 'not_triggered']
    candidateIds: list[str] = Field(max_length=10)
    unknownPeople: int = Field(ge=0, le=100)
    decision: Literal['hold', 'check']

def experiment_tasks():
    tasks = []
    for key, value, fresh in [('fresh_alert', 65, True), ('stale', 65, False), ('no_trigger', 40, True), ('missing', None, True)]:
        tasks.append({'id': key, 'title': {'fresh_alert': '新鲜测试异常', 'stale': '过期高读数', 'no_trigger': '未触发测试条件', 'missing': '读数缺失'}[key],
            'boundary': '固定软件测试案例，与当前工厂实时数据隔离；60℃不是工程限值。',
            'tables': {'device': {'id': 'B-05', 'temperature': value, 'unit': '℃', 'ageSeconds': 5 if fresh else 300},
                       'rules': [{'metric': 'temperature', 'operator': 'gte', 'threshold': 60, 'unit': '℃', 'scope': 'software_test', 'maxAgeSeconds': 120}],
                       'connections': [{'source': 'B-05', 'target': 'PIPE-B-05', 'verified': False}, {'source': 'B-01', 'target': 'B-05', 'verified': False}, {'source': 'B-05', 'target': 'Z007', 'verified': False}],
                       'people': [{'id': 'P014', 'zone': 'Z007', 'ageSeconds': 5}, {'id': 'P015', 'zone': None, 'ageSeconds': 300}],
                       'instructions': '读取有效性、单项测试条件、候选关联编号和未知位置人数；过期或缺失先补采样，其余安排核查。'}})
    return tasks

def solve_experiment(task):
    tables = task['tables']; device = tables['device']
    state = 'unknown' if device['temperature'] is None or device['ageSeconds'] > 120 else 'triggered' if device['temperature'] >= tables['rules'][0]['threshold'] else 'not_triggered'
    ids = sorted({r['target'] if r['source'] == device['id'] else r['source'] for r in tables['connections'] if device['id'] in (r['source'], r['target'])})
    answer = {'observation': state, 'candidateIds': ids,
              'unknownPeople': sum(p['ageSeconds'] > 120 for p in tables['people']),
              'decision': 'hold' if state == 'unknown' else 'check'}
    return {'answer': answer, 'tools': [
        {'tool': 'check_observation_and_test_rule', 'input': device, 'output': state},
        {'tool': 'query_candidate_connections', 'input': tables['connections'], 'output': ids},
        {'tool': 'check_personnel_freshness', 'input': tables['people'], 'output': answer['unknownPeople']},
    ], 'boundary': '仅用于原型答题计时；不产生真实现场处置指令。'}

class Business:
    def __init__(self, factory, analysis, accounts):
        self.factory, self.analysis, self.accounts = factory, analysis, accounts
        with analysis.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS prototype_runs (id TEXT PRIMARY KEY,owner TEXT,payload TEXT)')

    def documents(self):
        with self.analysis.lock, self.analysis.connect() as db:
            return {'scenario': self.analysis.get(db, 'businessScenario', SCENARIO),
                    'rules': self.analysis.get(db, 'businessRules', [])}

    def scenario(self, value, user):
        with self.analysis.lock, self.analysis.connect() as db:
            db.execute('BEGIN IMMEDIATE'); old = self.analysis.get(db, 'businessScenario', SCENARIO)
            if old['version'] != value.expectedVersion: raise HTTPException(409, '业务场景已变更，请刷新')
            row = {**old, **value.model_dump(exclude={'expectedVersion'}), 'version': old['version']+1,
                   'status': 'submitted', 'author': user['id'], 'reviewer': None}
            row['history'] = (old['history'] + [{'action': 'submit', 'actor': user['id'], 'at': stamp(), 'previous': {k:v for k,v in old.items() if k!='history'}}])[-100:]
            self.analysis.put(db, 'businessScenario', row)
            return row

    def propose_rule(self, value, user):
        entity = next((e for e in self.factory.snapshot()['entities'] if e['id'] == value.entityId and e['kind']=='device'), None)
        if not entity: raise HTTPException(404, '设备不存在')
        reading = entity.get('measurements', {}).get(value.metric)
        if not reading or reading['unit'] != value.unit: raise HTTPException(422, '规则指标和单位必须与设备台账一致；未接入指标不能注册为有效规则')
        row = {**value.model_dump(mode='json'), 'id': 'RULE-'+uuid.uuid4().hex[:12].upper(), 'version': 1,
               'status': 'submitted', 'author': user['id'], 'reviewer': None,
               'history': [{'action': 'submit', 'actor': user['id'], 'at': stamp()}]}
        with self.analysis.lock, self.analysis.connect() as db:
            db.execute('BEGIN IMMEDIATE'); rules = self.analysis.get(db, 'businessRules', [])
            if len(rules) >= 200: raise HTTPException(409, '规则达到200条，请归档')
            rules.append(row); self.analysis.put(db, 'businessRules', rules)
        return row

    def review(self, kind, id, value, user):
        with self.analysis.lock, self.analysis.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            rows = self.analysis.get(db, 'businessRules', []) if kind == 'rule' else [self.analysis.get(db, 'businessScenario', SCENARIO)]
            row = next((r for r in rows if r['id']==id), None)
            if not row: raise HTTPException(404, '复核对象不存在')
            if row['version'] != value.expectedVersion: raise HTTPException(409, '复核对象已变更，请刷新')
            if row['author'] == user['id']: raise HTTPException(403, '提出人不能复核自己的依据')
            if value.decision == 'approve' and not row.get('reference', '').strip(): raise HTTPException(422, '批准复核记录必须填写出处依据')
            demo = user['id'] in ('demo-safety','demo-maintenance','demo-reviewer','demo-observer')
            row.update(version=row['version']+1, status='rejected' if value.decision=='reject' else 'prototype_reviewed' if demo or row.get('purpose')=='software_test' else 'review_recorded',
                       reviewer=user['id'], qualification=value.qualification, reviewNote=value.note, reviewedAt=stamp())
            row['history'].append({'action': value.decision, 'actor': user['id'], 'at': stamp(),
                                   'qualification': value.qualification, 'note': value.note, 'scope': row['status']})
            self.analysis.put(db, 'businessRules' if kind=='rule' else 'businessScenario', rows if kind=='rule' else row)
            return row

    def start_run(self, value, user):
        task = next(t for t in experiment_tasks() if t['id']==value.taskId)
        row = {'id': 'RUN-'+uuid.uuid4().hex[:12], 'owner': user['id'], 'method': value.method,
               'task': task, 'startedAt': stamp(), 'startedEpoch': time.time(), 'status': 'running'}
        with self.analysis.lock,self.analysis.connect() as db:
            if db.execute('SELECT COUNT(*) FROM prototype_runs').fetchone()[0] >= 2000: raise HTTPException(409, '原型实验达到2000条，请导出归档')
            db.execute('INSERT INTO prototype_runs VALUES(?,?,?)', (row['id'], user['id'], json.dumps(row,ensure_ascii=False)))
        return row

    def run(self, id, user, finish=None, assist=False):
        with self.analysis.lock,self.analysis.connect() as db:
            db.execute('BEGIN IMMEDIATE'); result = db.execute('SELECT owner,payload FROM prototype_runs WHERE id=?',(id,)).fetchone()
            if not result: raise HTTPException(404, '实验不存在')
            if result[0] != user['id']: raise HTTPException(403, '只能操作自己的实验')
            row = json.loads(result[1])
            if row['status'] != 'running': raise HTTPException(409, '实验已完成，不能重复提交')
            elapsed = time.time()-row['startedEpoch']
            if elapsed < 0 or elapsed > 3600: raise HTTPException(409, '实验计时无效或超过一小时，请重开')
            if assist:
                if row['method'] != 'system': raise HTTPException(403, '人工查表组不能调用实验助手')
                start = time.perf_counter(); solved = solve_experiment(row['task'])
                row['assisted'] = True; row['toolMs'] = round((time.perf_counter()-start)*1000,3)
                db.execute('UPDATE prototype_runs SET payload=? WHERE id=?',(json.dumps(row,ensure_ascii=False),id))
                return {**solved, 'toolMs': row['toolMs']}
            if row['method']=='system' and not row.get('assisted'): raise HTTPException(409, '系统组请先运行实验助手')
            expected = solve_experiment(row['task'])['answer']; answer = finish.model_dump()
            answer['candidateIds'] = sorted(set(answer['candidateIds']))
            fields = {key:answer[key]==expected[key] for key in expected}
            row.update(status='finished', finishedAt=stamp(), durationSeconds=round(elapsed,3),
                       answer=answer, correctness=fields, score=sum(fields.values()), expected=expected)
            db.execute('UPDATE prototype_runs SET payload=? WHERE id=?',(json.dumps(row,ensure_ascii=False),id))
            return row

    def report(self, user):
        with self.analysis.connect() as db:
            rows = [json.loads(r[0]) for r in db.execute('SELECT payload FROM prototype_runs WHERE owner=?',(user['id'],))]
        complete = [r for r in rows if r['status']=='finished']
        pairs = []
        for task in experiment_tasks():
            groups = {method:[r for r in complete if r['task']['id']==task['id'] and r['method']==method and r['score']==4] for method in ('manual','system')}
            if all(groups.values()):
                means = {k:statistics.median(r['durationSeconds'] for r in v) for k,v in groups.items()}
                pairs.append({'taskId':task['id'], **means, 'savedSeconds':round(means['manual']-means['system'],3)})
        return {'runs': rows, 'finished': len(complete), 'fullyCorrect': sum(r['score']==4 for r in complete),
                'pairedTasks': pairs, 'medianSavedSeconds': statistics.median(p['savedSeconds'] for p in pairs) if pairs else None,
                'boundary': '服务器记录答题用时，人员身份、学习顺序与实验操作仍需监督；只统计本账号同题且全对的配对，不代表企业效率、安全或成本收益。'}

def install_business(app, factory, analysis, accounts):
    business = Business(factory, analysis, accounts)
    router = APIRouter(prefix='/factory/business', tags=['business-evidence'])
    @router.get('')
    def documents(): return business.documents()
    @router.post('/scenario')
    def scenario(value:ScenarioProposal, request:Request): return business.scenario(value, accounts.require(request,{'safety'}))
    @router.post('/rules')
    def rule(value:RuleProposal, request:Request): return business.propose_rule(value, accounts.require(request,{'safety'}))
    @router.post('/review/{kind}/{id}')
    def review(kind:Literal['rule','scenario'], id:str, value:EvidenceReview, request:Request):
        return business.review(kind,id,value,accounts.require(request,{'reviewer'}))
    @router.post('/maintenance/check')
    def check(value:MaintenanceRequest):
        data= factory.snapshot(); entity=next((e for e in data['entities'] if e['id']==value.entityId and e['kind']=='device'),None)
        if not entity: raise HTTPException(404, '设备不存在')
        with analysis.lock,analysis.connect() as db: plans=analysis.get(db,'plans',[])
        return maintenance_check(entity,value.plan,plans)
    @router.get('/experiment/tasks')
    def tasks(): return experiment_tasks()
    @router.post('/experiment/runs')
    def start(value:RunStart,request:Request): return business.start_run(value,accounts.require(request))
    @router.post('/experiment/runs/{id}/assist')
    def assist(id:str,request:Request): return business.run(id,accounts.require(request),assist=True)
    @router.post('/experiment/runs/{id}/finish')
    def finish(id:str,value:RunFinish,request:Request): return business.run(id,accounts.require(request),finish=value)
    @router.get('/experiment/report')
    def report(request:Request): return business.report(accounts.require(request))
    app.include_router(router);app.state.factory_business=business
