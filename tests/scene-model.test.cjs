const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
const helper=import(pathToFileURL(path.join(root,'frontend/scene-layout.mjs')).href);
const zones=JSON.parse(fs.readFileSync(path.join(root,'gis/danger_zones.geojson'),'utf8')).features;

test('excavation follows its GIS footprint and leaves the lifting area at grade',async()=>{
    const {worldPoint,surfaceHeight}=await helper,UI=require('../frontend/ui-core.js');
    const [east,north]=UI.localPoint(120.00755,30.29470);
    assert.deepEqual(worldPoint(120.00755,30.29470),[east,-north]);
    assert.equal(surfaceHeight(120.00755,30.29470,zones),-10);
    assert.equal(surfaceHeight(120.01025,30.29322,zones),0);
    assert.equal(surfaceHeight(120.006,30.293,zones),0);
    const pit=zones[0],withHole={...pit,geometry:{...pit.geometry,coordinates:[...pit.geometry.coordinates,[[120.0077,30.2943],[120.0083,30.2943],[120.0083,30.2947],[120.0077,30.2947],[120.0077,30.2943]]]}};
    assert.equal(surfaceHeight(120.008,30.2945,[withHole]),0);
});

test('overlapping projected labels are separated and clipped away from controls',async()=>{
    const {placeLabels}=await helper;
    const items=Array.from({length:9},(_,i)=>({id:'label'+i,x:220,y:230,width:80,height:23,priority:i,visible:true}));
    const positions=placeLabels(items,440,480);
    assert.ok(positions.size>=6);assert.ok(positions.has('label8'));
    const rectangles=[...positions.values()].map(p=>({...p,w:80,h:23}));
    for(const r of rectangles){assert.ok(r.x>=5 && r.x+r.w<=435 && r.y>=66 && r.y+r.h<=435);}
    for(let i=0;i<rectangles.length;i++)for(let j=i+1;j<rectangles.length;j++){
        const a=rectangles[i],b=rectangles[j];assert.ok(a.x+a.w<=b.x || b.x+b.w<=a.x || a.y+a.h<=b.y || b.y+b.h<=a.y);
    }
    assert.equal(placeLabels([{...items[0],visible:false}],440,480).size,0);
});

test('model terrain has a real excavation opening, batched parts, and isolated cutaway materials',async()=>{
    const vendor=pathToFileURL(path.join(root,'frontend/vendor/three/three.module.js')).href;
    const local=pathToFileURL(path.join(root,'frontend/scene-layout.mjs')).href;
    const source=fs.readFileSync(path.join(root,'frontend/construction-model.js'),'utf8').replace("from 'three'",`from '${vendor}'`).replace("from './scene-layout.mjs'",`from '${local}'`);
    const {buildLandscape}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
    const THREE=await import(vendor),site=buildLandscape(zones);site.updateMatrixWorld(true);
    assert.equal(site.userData.parts.length,11);
    const ray=new THREE.Raycaster(new THREE.Vector3(0,30,-166.98),new THREE.Vector3(0,-1,0));
    const ground=site.getObjectByName('yard');assert.equal(ray.intersectObject(ground,true).length,0);
    const pit=site.getObjectByName('pit-Z001');assert.ok(pit && pit.children.some(m=>m.geometry?.type==='ShapeGeometry'));
    let meshes=0,instances=0;site.traverse(o=>{if(o.isMesh)meshes++;if(o.isInstancedMesh)instances+=o.count;});
    assert.ok(meshes<110);assert.ok(instances>1500);
    const buildingMats=new Set(site.getObjectByName('building-a').children.map(m=>m.material));
    for(const part of site.children.filter(g=>g.name!=='building-a'))for(const mesh of part.children)assert.ok(!buildingMats.has(mesh.material));
});
