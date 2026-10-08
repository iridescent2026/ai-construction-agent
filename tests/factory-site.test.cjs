const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),frontend=path.join(root,'frontend'),modules=new Map();
function moduleUrl(file){
 if(modules.has(file))return modules.get(file);
 let source=fs.readFileSync(file,'utf8').replace(/from 'three'/g,`from '${pathToFileURL(path.join(frontend,'vendor/three/three.module.js')).href}'`);
 source=source.replace(/from '(\.\/[^']+)'/g,(_,relative)=>`from '${moduleUrl(path.resolve(path.dirname(file),relative))}'`);
 const url='data:text/javascript;base64,'+Buffer.from(source).toString('base64');modules.set(file,url);return url;
}
const site=JSON.parse(fs.readFileSync(path.join(frontend,'assets/factory/reference-site.json'))),plan=JSON.parse(fs.readFileSync(path.join(frontend,'assets/factory/factory-plan.geojson')));

test('A/B floors, equipment and hazard ranges fit the same exterior footprints',async()=>{
 const {buildFactory}=await import(moduleUrl(path.join(frontend,'factory-model.mjs'))),{FOOTPRINTS}=await import(moduleUrl(path.join(frontend,'factory-footprints.mjs'))),{pointInPolygon,placeEntity,featurePoints}=await import(moduleUrl(path.join(frontend,'gis-reference-geometry.mjs')));
 const THREE=await import(pathToFileURL(path.join(frontend,'vendor/three/three.module.js'))),{DEMO_PATHS}=await import(pathToFileURL(path.join(frontend,'factory-safety.mjs')));
 for(const view of ['a','b']){
  const polygon=FOOTPRINTS[view],building=plan.features.find(f=>f.properties.workArea===view),exterior=featurePoints(site,building);
  polygon.forEach(([x,z],i)=>{const actual=placeEntity(site,view,x,z);assert.ok(Math.hypot(actual[0]-exterior[i][0],actual[1]-exterior[i][1])<.00001);});
  const model=buildFactory(view);model.updateMatrixWorld(true);
  for(const entity of [...model.userData.devices,...model.userData.people]){
   const bounds=new THREE.Box3().setFromObject(model.getObjectByName(entity.id));
   for(const x of [bounds.min.x,bounds.max.x])for(const z of [bounds.min.z,bounds.max.z])assert.ok(pointInPolygon([x,z],polygon),entity.id+' must fit inside '+view);
  }
  for(const zone of model.userData.zones)for(const dx of [-1,1])for(const dz of [-1,1])assert.ok(pointInPolygon([zone.center[0]+dx*zone.size[0]/2,zone.center[1]+dz*zone.size[1]/2],polygon),zone.id+' must fit');
  for(const p of DEMO_PATHS[view].points)assert.ok(pointInPolygon(p,polygon));
 }
});

test('shared exterior has no business actors and cutaway contains both aligned work areas',async()=>{
 const {buildFactorySite,updateFactorySite}=await import(moduleUrl(path.join(frontend,'factory-site-model.mjs'))),exterior=buildFactorySite(site,plan),section=buildFactorySite(site,plan,new Map(),{cutaway:true});
 assert.equal(exterior.userData.workAreas.size,0);assert.equal(exterior.userData.areaLabels.length,0);
 assert.deepEqual([...section.userData.workAreas.keys()],['a','b']);assert.equal(section.userData.areaLabels.length,2);
 for(const building of exterior.userData.buildings)if(['F-A','F-B'].includes(building.id))assert.ok(building.mesh);
 for(const building of section.userData.buildings)if(['F-A','F-B'].includes(building.id))assert.equal(building.mesh,null);
 const data={entities:[{id:'P016',anchor:[-18,2.7,-14]}],active:[]};
 updateFactorySite(section,data);const person=section.userData.workAreas.get('b').getObjectByName('P016');assert.equal(person.position.x,-18);assert.equal(person.position.z,-14);
 updateFactorySite(section,data,{person:false,device:true,zone:true});assert.equal(person.visible,false);
 for(const id of ['P001','P016','B-07','Z005'])assert.equal(exterior.getObjectByName(id),undefined);
});
