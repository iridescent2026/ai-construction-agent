const test=require('node:test'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),path=require('node:path');
global.window={APP_CONFIG:{gis:'http://127.0.0.1:8000'}};
const load=()=>import(pathToFileURL(path.resolve(__dirname,'../frontend/outdoor-data.mjs')));
test('outdoor alarm filtering never mixes A/B alerts or calls stale workers safe',async()=>{
 const {outdoorSnapshot}=await load();const data={entities:[{id:'P021',kind:'person',view:'overview',riskState:'clear',positionTimestamp:new Date(Date.now()-121000).toISOString()},{id:'P001',view:'a'}],active:[{entityId:'P021',view:'overview',state:'danger'},{entityId:'P001',view:'a',state:'danger'}],events:[{view:'b'},{view:'overview'}]};const result=outdoorSnapshot(data);
 assert.equal(result.entities.length,1);assert.equal(result.active.length,1);assert.equal(result.active[0].state,'unknown');assert.equal(result.events.length,1);
});
test('refresh cannot roll back the poll but a restarted server can recover',async()=>{const {acceptsRevision}=await load();assert.equal(acceptsRevision({revision:4,instanceId:'a'},{revision:3,instanceId:'a'}),false);assert.equal(acceptsRevision({revision:4,instanceId:'a'},{revision:1,instanceId:'b'}),true);});

test('replay evaluates freshness at capture time and preserves unknown historic readings',async()=>{
 const {factorySnapshot}=await load();const capturedAt='2025-01-01T12:00:00Z';
 const data={entities:[{id:'fresh',kind:'person',positionTimestamp:'2025-01-01T11:59:59Z',riskState:'danger'},{id:'expired',kind:'person',positionTimestamp:'2025-01-01T11:57:00Z',riskState:'clear'},{id:'missing',kind:'person',riskState:'clear'}],active:[]};
 assert.deepEqual(factorySnapshot(data,false,capturedAt).entities.map(e=>e.riskState),['danger','unknown','unknown']);
 const {measurementText}=await import(pathToFileURL(path.resolve(__dirname,'../frontend/factory-client.mjs')));
 assert.doesNotMatch(measurementText({measurements:{power:{value:6,unit:'kW'}},measurementTimestamp:'2025-01-01T11:59:59Z'},capturedAt),/已过期/);
});

test('A/B cutaway receives full observations while outdoor alarm counts stay separate',async()=>{
 const {factorySnapshot,outdoorSnapshot}=await load();const now=new Date().toISOString();
 const data={entities:[{id:'P001',view:'a',kind:'person',anchor:[-8,2,3],positionTimestamp:now,riskState:'danger'},{id:'P016',view:'b',kind:'person',anchor:[18,2,7],positionTimestamp:new Date(Date.now()-121000).toISOString(),riskState:'clear'},{id:'P023',view:'overview',kind:'person',anchor:[-28,0,23],positionTimestamp:now,riskState:'danger'}],active:[{entityId:'P001',view:'a'},{entityId:'P023',view:'overview'}]};
 const section=factorySnapshot(data),outdoor=outdoorSnapshot(data);
 assert.equal(section.entities.length,3);assert.equal(section.active.length,2);assert.deepEqual(section.entities[0].anchor,[-8,2,3]);assert.equal(section.entities[1].riskState,'unknown');
 assert.deepEqual(outdoor.entities.map(e=>e.id),['P023']);assert.deepEqual(outdoor.active.map(e=>e.entityId),['P023']);
 assert.ok(factorySnapshot(data,true).entities.every(e=>e.riskState==='unknown'));
});
