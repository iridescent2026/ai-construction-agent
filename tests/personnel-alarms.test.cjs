const test=require('node:test'),assert=require('node:assert/strict');
test('homepage alarm scope includes only A/B personnel, excluding outdoor alerts and vehicles',async()=>{
 const {personnelSafetySnapshot}=await import('../frontend/personnel-alarms.mjs');
 const people=['P003','P010','P014','P018'].map((id,i)=>({id,kind:'person',view:i<2?'a':'b'}));
 const entities=[...people,{id:'P023',kind:'person',view:'overview'},{id:'E004',kind:'device',view:'b'}];
 const active=entities.map(e=>({id:e.id+':Z',entityId:e.id,view:e.view}));
 const snapshot=personnelSafetySnapshot({entities,active,events:active});
 assert.equal(snapshot.active.length,4);assert.equal(snapshot.events.length,4);assert.equal(snapshot.people,4);
 assert.deepEqual(snapshot.active.map(a=>a.entityId),people.map(p=>p.id));
});
test('a later clear frame produces zero alarms without retaining previous counts',async()=>{
 const {personnelSafetySnapshot}=await import('../frontend/personnel-alarms.mjs');
 const entities=[{id:'P003',kind:'person',view:'a'}];
 assert.equal(personnelSafetySnapshot({entities,active:[{entityId:'P003',view:'a'}]}).active.length,1);
 assert.equal(personnelSafetySnapshot({entities,active:[]}).active.length,0);
});
