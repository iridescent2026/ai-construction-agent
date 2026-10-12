const test=require('node:test'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),path=require('node:path');
const {deviceState}=require('../frontend/ui-core.js');
global.window={APP_CONFIG:{gis:'http://test.invalid'}};
const client=import(pathToFileURL(path.resolve(__dirname,'../frontend/factory-client.mjs')).href);
test('fresh factory measurements without engineering rules stay unknown rather than low risk',()=>{
 const view=deviceState({factory:true,timestamp:new Date().toISOString(),status:'online',riskState:'clear',measurementProvenance:{kind:'manual'}});
 assert.equal(view.level,'未知');assert.match(view.label,/手动观测.*待核验/);
});
test('source labels distinguish manual observations, declared collectors, simulation and legacy imports',async()=>{
 const {observationSource}=await client;
 assert.equal(observationSource({measurementSource:'telemetry',measurementProvenance:{kind:'manual'}}),'手动测试导入');
 assert.match(observationSource({measurementSource:'telemetry',measurementProvenance:{kind:'authenticated_import'}}),/设备未核验/);
 assert.match(observationSource({measurementSource:'telemetry'}),/来源未核验/);
 assert.equal(observationSource({measurementSource:'demo'}),'后台模拟');
});
