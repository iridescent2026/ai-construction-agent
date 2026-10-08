const test=require('node:test'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),path=require('node:path');
const guide=import(pathToFileURL(path.join(__dirname,'../frontend/observation-guide.mjs')).href);
test('observation examples describe an entry, exit and independent device reading',async()=>{
 const {parseObservations,observationExample,importedSummary}=await guide;
 assert.deepEqual(parseObservations(observationExample('enter')).observations[0],{id:'P023',x:-28,z:23});
 assert.deepEqual(parseObservations(observationExample('leave')).observations[0],{id:'P023',x:-41,z:12});
 assert.equal(parseObservations(observationExample('temperature')).observations[0].measurements.temperature.unit,'℃');
 const result={entities:[{id:'P023',riskState:'danger',currentZones:['Z001']},{id:'Z001',title:'土方施工区'}]};
 assert.match(importedSummary(result,[{id:'P023',x:-28,z:23}]),/Z001 土方施工区/);
 result.entities[0].riskState='unknown';assert.match(importedSummary(result,[{id:'P023',x:-28,z:23}]),/位置已过期/);
});
test('invalid JSON, missing axes, duplicate IDs and non-numeric coordinates never reach import',async()=>{
 const {parseObservations}=await guide;
 for(const input of ['bad','{}','{"observations":[]}','{"observations":[{"id":"P023","x":2}]}','{"observations":[{"id":"P023","x":"2","z":3}]}','{"observations":[{"id":"P023","x":2001,"z":3}]}','{"observations":[{"id":"P023","x":1,"z":1},{"id":"P023","x":2,"z":2}]}'])assert.throws(()=>parseObservations(input));
});
