const test=require('node:test'),assert=require('node:assert/strict');
const modulePromise=import('../frontend/factory-safety.mjs');
const zone={id:'Z001',kind:'zone',view:'overview',title:'土方施工区',center:[0,0],size:[10,8]};
const person={id:'P001',kind:'person',view:'overview',title:'施工工人',anchor:[8,2,0]};

test('zone boundaries and view identity determine occupancy; invalid positions remain unknown',async()=>{
    const {evaluateOccupancy}=await modulePromise;
    assert.equal(evaluateOccupancy(person,[zone]).state,'clear');
    assert.deepEqual(evaluateOccupancy({...person,anchor:[5,2,4]},[zone]),{state:'danger',zones:['Z001']});
    assert.equal(evaluateOccupancy({...person,view:'b',anchor:[0,2,0]},[zone]).state,'clear');
    assert.equal(evaluateOccupancy({...person,anchor:[NaN,2,0]},[zone]).state,'unknown');
});
test('enter alarms are not repeated each sample; leaving resolves active alarms and records the transition',async()=>{
    const {FactorySafety}=await modulePromise,p={...person,anchor:[8,2,0]},engine=new FactorySafety([p,zone]);
    assert.equal(engine.evaluate(1000).active.length,0);p.anchor[0]=0;
    const entered=engine.evaluate(2000);assert.equal(entered.active.length,1);assert.equal(entered.events.length,1);assert.equal(entered.events[0].type,'enter');
    assert.equal(engine.evaluate(3000).events.length,1);assert.equal(engine.evaluate(3000).active[0].time,2000);
    p.anchor[0]=8;const left=engine.evaluate(4000);assert.equal(left.active.length,0);assert.equal(left.events[0].type,'leave');
    p.anchor[0]=0;assert.equal(engine.evaluate(5000).events.length,3);
});
test('fixed machinery and authorized excavators avoid false entry alerts; restricted transport vehicles alarm',async()=>{
    const {evaluateOccupancy}=await modulePromise,vehicle={id:'E-04',kind:'device',view:'overview',anchor:[0,4,0],mobile:true};
    assert.equal(evaluateOccupancy({...vehicle,mobile:false},[zone]).state,'not-applicable');
    assert.equal(evaluateOccupancy({...vehicle,allowedZones:['Z001']},[zone]).state,'clear');
    assert.equal(evaluateOccupancy(vehicle,[zone]).state,'danger');
});
test('unknown observations do not fabricate a leave event; recovery to a clear position resolves occupancy',async()=>{
    const {FactorySafety}=await modulePromise,p={...person,anchor:[0,2,0]},engine=new FactorySafety([p,zone]);
    engine.evaluate(1);p.anchor[0]=NaN;const unknown=engine.evaluate(2);assert.equal(unknown.events.length,1);assert.equal(unknown.active.length,1);assert.equal(p.riskState,'unknown');
    p.anchor[0]=8;const clear=engine.evaluate(3);assert.equal(p.riskState,'clear');assert.equal(clear.active.length,0);assert.equal(clear.events[0].type,'leave');
});
test('all four animation paths enter their intended zones and return to their starting positions',async()=>{
    const {demoPosition,DEMO_PATHS,containsPoint}=await modulePromise;
    const zones={overview:{...zone,center:[-18,27],size:[36,26]},vehicle:{...zone,center:[28,6],size:[32,26]},a:{...zone,center:[-14,-9],size:[20,8]},b:{...zone,center:[-12.5,-9],size:[22,9]}};
    for(const [key,path] of Object.entries(DEMO_PATHS)){assert.equal(containsPoint(zones[key],...demoPosition(path,0)),false);assert.equal(containsPoint(zones[key],...demoPosition(path,12)),true);assert.deepEqual(demoPosition(path,24),path.points[0]);}
});
