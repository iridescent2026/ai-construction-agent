const test=require('node:test'),assert=require('node:assert/strict');
const state={revision:23,updatedAt:'2026-10-12T04:00:00Z',entities:[]};
const modulePath='../frontend/refresh-controller.mjs';
test('manual refresh shares one state among views and awaits the dependent analysis and case',async()=>{
 const {createRefreshController}=await import(modulePath);const calls=[],applied=[];
 const c=createRefreshController({readState:async()=>{calls.push('GET state');return state;}});
 c.register('map',{apply:s=>applied.push(s)});c.register('model',{apply:s=>applied.push(s)});
 c.register('analysis',{read:async()=>calls.push('GET analysis')});c.register('case',{read:async()=>calls.push('GET case')});
 const result=await c.refresh();assert.deepEqual(applied,[state,state]);assert.equal(calls.filter(i=>i==='GET state').length,1);assert.deepEqual(result.completed,['map','model','analysis','case']);assert.deepEqual(result.failures,[]);
});
test('double clicks share the in-flight request, and a later click issues a fresh read',async()=>{
 const {createRefreshController}=await import(modulePath);let finish,reads=0,starts=0,ends=0;
 const c=createRefreshController({readState:()=>{reads++;return new Promise(r=>finish=r);},onStart:()=>starts++,onFinish:()=>ends++});
 const first=c.refresh(),second=c.refresh();assert.equal(first,second);finish(state);await first;assert.equal(reads,1);assert.equal(starts,1);assert.equal(ends,1);
 const third=c.refresh();finish({...state,revision:24});assert.equal((await third).revision,24);assert.equal(reads,2);
});
test('a failed analysis is reported as partial, not as all modules refreshed',async()=>{
 const {createRefreshController}=await import(modulePath);const c=createRefreshController({readState:async()=>state});
 c.register('map',{apply:()=>{}});c.register('analysis',{read:async()=>{throw new Error('Not Found');}});
 const result=await c.refresh();assert.deepEqual(result.completed,['map']);assert.deepEqual(result.failures,[{name:'analysis',message:'Not Found'}]);
});
test('a state outage marks views offline, does not fabricate data, and still restores controls',async()=>{
 const {createRefreshController}=await import(modulePath);let applied=0,offline=0,ended=0;
 const c=createRefreshController({readState:async()=>{throw new Error('断流');},onFinish:()=>ended++});c.register('view',{apply:()=>applied++,offline:()=>offline++});
 await assert.rejects(c.refresh(),/断流/);assert.equal(applied,0);assert.equal(offline,1);assert.equal(ended,1);
});
test('malformed state fails rather than advertising a successful refresh',async()=>{
 const {createRefreshController}=await import(modulePath);const c=createRefreshController({readState:async()=>({entities:[]})});await assert.rejects(c.refresh(),/格式无效/);
});
