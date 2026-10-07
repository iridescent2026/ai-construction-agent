const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url'),root=path.resolve(__dirname,'..');
const vendor=pathToFileURL(path.join(root,'frontend/vendor/three/three.module.js')).href;
const source=fs.readFileSync(path.join(root,'frontend/factory-model.mjs'),'utf8').replace("from 'three'",`from '${vendor}'`).replace("from './factory-footprints.mjs'",`from '${pathToFileURL(path.join(root,'frontend/factory-footprints.mjs')).href}'`);
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
    assert.equal(a.userData.devices.length,12);assert.equal(b.userData.devices.length,12);assert.equal(overview.userData.devices.length,6);
    assert.equal(a.userData.workerCount,12);assert.equal(b.userData.workerCount,8);assert.equal(overview.userData.workerCount,6);
    assert.deepEqual(overview.userData.locations.map(p=>p.view),['a','b']);
    const all=[...a.userData.devices,...b.userData.devices,...overview.userData.devices];assert.equal(new Set(all.map(d=>d.id)).size,30);
    for(const scene of [a,b]){
        for(const d of scene.userData.devices){assert.match(d.title,/[\u4e00-\u9fff]/);assert.equal(scene.getObjectByName(d.id).userData,d);assert.equal(d.anchor.length,3);assert.ok(d.anchor.every(Number.isFinite));}
        const floorDevices=scene.userData.devices.filter(d=>!['A-09','A-10','A-11','A-12'].includes(d.id));
        for(let i=0;i<floorDevices.length;i++)for(let j=i+1;j<floorDevices.length;j++){const x=floorDevices[i].anchor,z=floorDevices[j].anchor;assert.ok(Math.hypot(x[0]-z[0],x[2]-z[2])>=10,'equipment inspection areas must not overlap');}
    }
    assert.ok(a.userData.devices.some(d=>d.title.includes('冲压')));assert.ok(b.userData.devices.some(d=>d.title.includes('10kV')));
    assert.equal(a.userData.architecture,'high-bay-steel');assert.equal(b.userData.architecture,'power-hall-with-control-wing');
    assert.ok(a.getObjectByName('steel-roof-trusses'));assert.ok(a.getObjectByName('A-10'));assert.ok(a.getObjectByName('A-12'));
    assert.ok(b.getObjectByName('basement-concrete-shell'));assert.ok(b.getObjectByName('basement-access-stairs'));assert.ok(b.getObjectByName('grated-cable-channel'));assert.equal(b.getObjectByName('steel-roof-trusses'),undefined);
    assert.ok(VIEWS.overview.camera[1]>180);assert.throws(()=>buildFactory('unknown'));
});

test('bundled open assets and their external textures match the recorded source hashes',()=>{
    const folder=path.join(root,'frontend/assets/factory'),manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json')));
    assert.equal(manifest.filter(e=>e.file.endsWith('.glb')).length,9);
    for(const item of manifest){const data=fs.readFileSync(path.join(folder,item.file));assert.equal(data.length,item.bytes);assert.equal(crypto.createHash('sha256').update(data).digest('hex'),item.sha256);assert.equal(item.license,'CC0-1.0');
        if(item.file.endsWith('.glb')){assert.equal(data.toString('ascii',0,4),'glTF');assert.equal(data.readUInt32LE(8),data.length);const json=JSON.parse(data.toString('utf8',20,20+data.readUInt32LE(12)));for(const image of json.images||[])if(image.uri&&!image.uri.startsWith('data:'))assert.ok(fs.existsSync(path.join(folder,image.uri)));}
        if(item.file.endsWith('.gltf')){const json=JSON.parse(data);for(const resource of [...json.buffers,...json.images])if(resource.uri&&!resource.uri.startsWith('data:')){const file=path.resolve(folder,path.dirname(item.file),resource.uri);assert.ok(fs.existsSync(file),resource.uri+' must be bundled');assert.ok(manifest.some(e=>path.resolve(folder,e.file)===file),resource.uri+' must have a provenance hash');}}
    }
});

test('power equipment does not intersect adjacent skids or the central access aisle',async()=>{
    const THREE=await import(vendor),{buildFactory}=await model,b=buildFactory('b');b.updateMatrixWorld(true);
    const bodies=b.userData.devices.map(d=>({id:d.id,box:new THREE.Box3().setFromObject(b.getObjectByName(d.id))}));
    const overlap=(a,b)=>Math.min(a.max.x,b.max.x)-Math.max(a.min.x,b.min.x)>.01&&Math.min(a.max.z,b.max.z)-Math.max(a.min.z,b.min.z)>.01;
    const aisle={min:{x:-43,z:-2.1},max:{x:41,z:2.1}};
    for(let i=0;i<bodies.length;i++){assert.ok(!overlap(bodies[i].box,aisle),bodies[i].id+' blocks the main aisle');for(let j=i+1;j<bodies.length;j++)assert.ok(!overlap(bodies[i].box,bodies[j].box),bodies[i].id+' intersects '+bodies[j].id);}
});

test('translated source pipe modules fit their requested valve locations',async()=>{
    const THREE=await import(vendor),{buildFactory}=await model,folder=path.join(root,'frontend/assets/factory'),gltf=JSON.parse(fs.readFileSync(path.join(folder,'industrial-pipes.gltf'))),pack=new THREE.Group();
    const node=gltf.nodes.find(n=>n.name.endsWith('_pipe08')),accessor=gltf.accessors[gltf.meshes[node.mesh].primitives[0].attributes.POSITION],bufferView=gltf.bufferViews[accessor.bufferView],binary=fs.readFileSync(path.join(folder,gltf.buffers[bufferView.buffer].uri)),offset=(bufferView.byteOffset||0)+(accessor.byteOffset||0),positions=new Float32Array(accessor.count*3);
    for(let i=0;i<accessor.count;i++)for(let k=0;k<3;k++)positions[i*3+k]=binary.readFloatLE(offset+i*(bufferView.byteStride||12)+k*4);
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));const source=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial());source.name=node.name;source.position.fromArray(node.translation);pack.add(source);
    const b=buildFactory('b',new Map([['industrial-pipes.gltf',pack]])),valves=b.getObjectByName('B-03');b.updateMatrixWorld(true);
    const imported=valves.children.filter(n=>n.name==='asset-industrial-pipes#pipe08');assert.equal(imported.length,8);
    for(const holder of [...imported,b.getObjectByName('B-05').getObjectByName('asset-industrial-pipes#pipe08')]){
        const expected=holder.getWorldPosition(new THREE.Vector3());
        for(const y of [accessor.min[1],accessor.max[1]]){const port=new THREE.Vector3(0,y,0).applyMatrix4(holder.children[0].matrixWorld);assert.ok(Math.abs(port.y-expected.y)<1e-5,'valve port height must match its pipe');if(holder.parent===valves)assert.ok(Math.abs(port.z-expected.z)<1e-5,'valve must align with the X header');else assert.ok(Math.abs(port.x-expected.x)<1e-5,'pump valve must align with the Z return');}
    }
});

test('solid A/B parts form contact chains to the floor instead of floating components',async()=>{
    const THREE=await import(vendor),{buildFactory}=await model;
    for(const view of ['a','b']){
        const scene=buildFactory(view),parts=[];scene.updateMatrixWorld(true);
        scene.traverse(o=>{if(!o.isMesh||o.material?.isMeshBasicMaterial)return;o.geometry.computeBoundingBox();
            const add=matrix=>parts.push({name:o.parent.name,box:o.geometry.boundingBox.clone().applyMatrix4(matrix)});
            if(o.isInstancedMesh)for(let i=0;i<o.count;i++){const m=new THREE.Matrix4();o.getMatrixAt(i,m);add(new THREE.Matrix4().multiplyMatrices(o.matrixWorld,m));}else add(o.matrixWorld);
        });
        // Broad-phase contact audit: expands every instance, excludes UI/zone
        // overlays, and tolerates 4.5 cm seams. Detailed joints are also inspected
        // in the browser; this is a geometry regression check, not load analysis.
        const touch=(a,b)=>['x','y','z'].every(k=>Math.max(a.min[k],b.min[k])-Math.min(a.max[k],b.max[k])<=.045);
        const connected=new Set(parts.map((p,i)=>p.box.min.y<=.1?i:-1).filter(i=>i>=0)),queue=[...connected];
        for(let k=0;k<queue.length;k++)for(let j=0;j<parts.length;j++)if(!connected.has(j)&&touch(parts[queue[k]].box,parts[j].box)){connected.add(j);queue.push(j);}
        assert.deepEqual(parts.filter((_,i)=>!connected.has(i)).map(p=>p.name),[],view+' has isolated solid parts');
    }
});

test('homepage entities bind to model objects and hazardous footprints contain their associated equipment',async()=>{
    const {buildFactory}=await model,scenes=['overview','a','b'].map(view=>buildFactory(view));
    const catalog=scenes.flatMap(scene=>[...scene.userData.devices,...scene.userData.people,...scene.userData.zones]);
    assert.equal(catalog.length,68);assert.equal(new Set(catalog.map(i=>i.id)).size,68);
    assert.equal(catalog.filter(i=>i.kind==='person').length,26);assert.equal(catalog.find(i=>i.id==='P001').view,'a');assert.equal(catalog.find(i=>i.id==='P002').view,'b');
    assert.equal(catalog.filter(i=>i.kind==='zone').length,12);
    for(const scene of scenes)for(const info of [...scene.userData.devices,...scene.userData.people,...scene.userData.zones]){
        assert.equal(info.view,scene.userData.view);assert.equal(scene.getObjectByName(info.id).userData,info);
        if(['P001','P002'].includes(info.id))assert.ok(Math.abs(info.anchor[2])<1,'original numbered people stay on the central walkway');
        if(info.kind==='zone')for(const id of info.devices){const device=scene.userData.devices.find(d=>d.id===id);assert.ok(device,`${id} belongs to the same view`);assert.ok(Math.abs(device.anchor[0]-info.center[0])<=info.size[0]/2);assert.ok(Math.abs(device.anchor[2]-info.center[1])<=info.size[1]/2);}
    }
});
