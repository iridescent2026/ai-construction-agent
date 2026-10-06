const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
const adapter=import(pathToFileURL(path.join(root,'frontend/factory-gis-data.mjs')).href);
const catalogue=JSON.parse(fs.readFileSync(path.join(root,'gis/factory-catalog.json'),'utf8'));
function snapshot(){return {revision:42,updatedAt:new Date().toISOString(),entities:structuredClone(catalogue.entities),active:[],coordinateSystem:{origin:[120.008,30.293],frames:{overview:[0,0,1],a:[-28,-19,.85],b:[39,-28,.55]}}};}

test('GIS transforms each work area consistently and preserves its equipment within the hazardous footprint',async()=>{
    const {adaptFactory,geoPoint}=await adapter,data=snapshot(),adapted=adaptFactory(data);
    for(const zone of data.entities.filter(e=>e.kind==='zone')){
        const feature=adapted.zones.features.find(f=>f.properties.zone_id===zone.id),ring=feature.geometry.coordinates[0];
        for(const id of zone.devices){const device=data.entities.find(e=>e.id===id),point=geoPoint(data,device.view,device.anchor[0],device.anchor[2]);assert.ok(point[0]>=Math.min(...ring.map(p=>p[0]))&&point[0]<=Math.max(...ring.map(p=>p[0])));assert.ok(point[1]>=Math.min(...ring.map(p=>p[1]))&&point[1]<=Math.max(...ring.map(p=>p[1])));}
    }
    assert.equal(adapted.devices.length,25);assert.equal(adapted.spatial.people.length,26);assert.equal(adapted.zones.features.length,8);assert.equal(adapted.snapshot_id,'42');
});

test('pressure telemetry keeps its source and units without fabricated electrical readings',async()=>{
    const {adaptFactory}=await adapter,data=snapshot(),e=data.entities.find(e=>e.id==='B-03');
    e.measurements={pressure:{value:.62,unit:'MPa'}};e.measurementTimestamp=new Date().toISOString();e.measurementSource='telemetry';
    const d=adaptFactory(data).devices.find(e=>e.device_id==='B-03');
    assert.equal(d.source,'telemetry');assert.equal(d.measurements.pressure.value,.62);assert.equal(d.measurements.pressure.unit,'MPa');assert.equal(d.load,undefined);assert.equal(d.leakage,undefined);assert.equal(d.temperature,undefined);
});
