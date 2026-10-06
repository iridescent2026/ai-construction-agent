const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url'),root=path.resolve(__dirname,'..');
const vendor=pathToFileURL(path.join(root,'frontend/vendor/three/three.module.js')).href;
const source=fs.readFileSync(path.join(root,'frontend/factory-model.mjs'),'utf8').replace("from 'three'",`from '${vendor}'`);
const model=import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));

test('backend catalogue matches every rendered entity and its coordinates',async()=>{
    const {buildFactory,VIEWS}=await model;
    const expected=Object.keys(VIEWS).flatMap(v=>{const m=buildFactory(v);return [...m.userData.devices,...m.userData.people,...m.userData.zones];});
    const actual=JSON.parse(fs.readFileSync(path.join(root,'gis/factory-catalog.json'),'utf8')).entities;
    assert.deepEqual(actual,expected);
});

test('two distinct work areas expose every hazard with a Chinese name and physically separated equipment',async()=>{
    const {buildFactory,VIEWS}=await model;
    const a=buildFactory('a'),b=buildFactory('b'),overview=buildFactory('overview');
    assert.equal(a.userData.devices.length,12);assert.equal(b.userData.devices.length,7);assert.equal(overview.userData.devices.length,6);
    assert.equal(a.userData.workerCount,12);assert.equal(b.userData.workerCount,8);assert.equal(overview.userData.workerCount,6);
    assert.deepEqual(overview.userData.locations.map(p=>p.view),['a','b']);
    const all=[...a.userData.devices,...b.userData.devices,...overview.userData.devices];assert.equal(new Set(all.map(d=>d.id)).size,25);
    for(const scene of [a,b]){
        for(const d of scene.userData.devices){assert.match(d.title,/[\u4e00-\u9fff]/);assert.equal(scene.getObjectByName(d.id).userData,d);assert.equal(d.anchor.length,3);assert.ok(d.anchor.every(Number.isFinite));}
        const floorDevices=scene.userData.devices.filter(d=>!['A-09','A-10','A-11','A-12'].includes(d.id));
        for(let i=0;i<floorDevices.length;i++)for(let j=i+1;j<floorDevices.length;j++){const x=floorDevices[i].anchor,z=floorDevices[j].anchor;assert.ok(Math.hypot(x[0]-z[0],x[2]-z[2])>=10,'equipment inspection areas must not overlap');}
    }
    assert.ok(a.userData.devices.some(d=>d.title.includes('冲压')));assert.ok(b.userData.devices.some(d=>d.title.includes('10kV')));
    assert.equal(a.userData.architecture,'high-bay-steel');assert.equal(b.userData.architecture,'l-shaped-basement');
    assert.ok(a.getObjectByName('steel-roof-trusses'));assert.ok(a.getObjectByName('A-10'));assert.ok(a.getObjectByName('A-12'));
    assert.ok(b.getObjectByName('basement-concrete-shell'));assert.ok(b.getObjectByName('basement-access-stairs'));assert.ok(b.getObjectByName('grated-cable-channel'));assert.equal(b.getObjectByName('steel-roof-trusses'),undefined);
    assert.ok(VIEWS.overview.camera[1]>180);assert.throws(()=>buildFactory('unknown'));
});

test('bundled open assets and their external textures match the recorded source hashes',()=>{
    const folder=path.join(root,'frontend/assets/factory'),manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json')));
    assert.equal(manifest.filter(e=>e.file.endsWith('.glb')).length,8);
    for(const item of manifest){const data=fs.readFileSync(path.join(folder,item.file));assert.equal(data.length,item.bytes);assert.equal(crypto.createHash('sha256').update(data).digest('hex'),item.sha256);assert.equal(item.license,'CC0-1.0');
        if(item.file.endsWith('.glb')){assert.equal(data.toString('ascii',0,4),'glTF');assert.equal(data.readUInt32LE(8),data.length);const json=JSON.parse(data.toString('utf8',20,20+data.readUInt32LE(12)));for(const image of json.images||[])if(image.uri&&!image.uri.startsWith('data:'))assert.ok(fs.existsSync(path.join(folder,image.uri)));}
    }
});

test('homepage entities bind to model objects and hazardous footprints contain their associated equipment',async()=>{
    const {buildFactory}=await model,scenes=['overview','a','b'].map(view=>buildFactory(view));
    const catalog=scenes.flatMap(scene=>[...scene.userData.devices,...scene.userData.people,...scene.userData.zones]);
    assert.equal(catalog.length,59);assert.equal(new Set(catalog.map(i=>i.id)).size,59);
    assert.equal(catalog.filter(i=>i.kind==='person').length,26);assert.equal(catalog.find(i=>i.id==='P001').view,'a');assert.equal(catalog.find(i=>i.id==='P002').view,'b');
    assert.equal(catalog.filter(i=>i.kind==='zone').length,8);
    for(const scene of scenes)for(const info of [...scene.userData.devices,...scene.userData.people,...scene.userData.zones]){
        assert.equal(info.view,scene.userData.view);assert.equal(scene.getObjectByName(info.id).userData,info);
        if(['P001','P002'].includes(info.id))assert.ok(Math.abs(info.anchor[2])<1,'original numbered people stay on the central walkway');
        if(info.kind==='zone')for(const id of info.devices){const device=scene.userData.devices.find(d=>d.id===id);assert.ok(device,`${id} belongs to the same view`);assert.ok(Math.abs(device.anchor[0]-info.center[0])<=info.size[0]/2);assert.ok(Math.abs(device.anchor[2]-info.center[1])<=info.size[1]/2);}
    }
});
