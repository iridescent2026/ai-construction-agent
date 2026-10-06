import * as THREE from 'three';
import {OrbitControls} from './vendor/three/OrbitControls.js';
import {buildLandscape} from './construction-model.js';
import {worldPoint,ringsOf,zoneBounds,surfaceHeight,placeLabels} from './scene-layout.mjs';

function disposeGroup(group) {
    const geometries=new Set(),materials=new Set(),textures=new Set();
    group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of [].concat(o.material||[])){materials.add(m);if(m.map)textures.add(m.map);}if(o.isInstancedMesh)o.dispose();});
    geometries.forEach(g=>g.dispose());textures.forEach(t=>t.dispose());materials.forEach(m=>m.dispose());group.clear();
}

export class SiteScene {
    constructor(container,onSelect) {
        this.container=container;this.onSelect=onSelect;this.visible=false;this.disposed=false;this.labels=[];this.modelVisible=true;this.namesVisible=true;this.cutaway=false;
        this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#192933');this.scene.fog=new THREE.Fog('#192933',1300,2300);
        this.camera=new THREE.PerspectiveCamera(43,1,1,3500);
        this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));
        this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.2;
        this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.shadowMap.autoUpdate=false;
        this.renderer.localClippingEnabled=true;this.clipPlane=new THREE.Plane(new THREE.Vector3(0,-1,0),28);
        container.appendChild(this.renderer.domElement);
        this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.minDistance=70;this.controls.maxDistance=1400;this.controls.maxPolarAngle=Math.PI/2.05;
        this.scene.add(new THREE.HemisphereLight(0xeaf7ff,0x66776b,2.1));
        this.sun=new THREE.DirectionalLight(0xffe3bd,3.1);this.sun.position.set(-280,540,260);this.sun.castShadow=true;
        this.sun.shadow.mapSize.set(2048,2048);Object.assign(this.sun.shadow.camera,{left:-440,right:440,top:440,bottom:-440,near:1,far:1100});this.sun.shadow.bias=-.00025;this.sun.shadow.normalBias=.5;this.scene.add(this.sun);
        this.root=new THREE.Group();this.scene.add(this.root);this.landscape=null;this.landscapeKey=null;this.pickable=[];
        this.labelLayer=document.createElement('div');this.labelLayer.className='scene-labels';container.appendChild(this.labelLayer);
        this.toolbar=document.createElement('div');this.toolbar.className='model-toolbar';this.toolbar.setAttribute('aria-label','施工模型工具');
        this.toolbar.innerHTML='<button type="button" data-model-action="top">俯视总图</button><button type="button" data-model-action="cut" aria-pressed="false">楼栋剖切</button><button type="button" data-model-action="models" aria-pressed="true">施工模型</button><button type="button" data-model-action="names" aria-pressed="true">模型标牌</button>';
        container.appendChild(this.toolbar);
        this.toolbar.addEventListener('click',e=>{const b=e.target.closest('[data-model-action]');if(!b)return;
            switch(b.dataset.modelAction){
                case 'top':this.controls.target.set(0,0,0);this.camera.position.set(0,860,2);this.controls.update();break;
                case 'cut':this.cutaway=!this.cutaway;b.setAttribute('aria-pressed',this.cutaway);this.applyCutaway();break;
                case 'models':this.modelVisible=!this.modelVisible;b.setAttribute('aria-pressed',this.modelVisible);this.landscape.visible=this.modelVisible;this.renderer.shadowMap.needsUpdate=true;break;
                case 'names':this.namesVisible=!this.namesVisible;b.setAttribute('aria-pressed',this.namesVisible);break;
            }
        });
        this.modelNote=document.createElement('div');this.modelNote.className='model-note';this.modelNote.textContent='施工场景示意 · 平面与 GIS 对齐 · 高度非实测';container.appendChild(this.modelNote);
        this.raycaster=new THREE.Raycaster();this.pointer=new THREE.Vector2();this.down=null;
        this.onDown=e=>{this.down=[e.clientX,e.clientY];};
        this.onUp=e=>{if(!this.down||Math.hypot(e.clientX-this.down[0],e.clientY-this.down[1])>5)return;
            const r=this.renderer.domElement.getBoundingClientRect();this.pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);this.raycaster.setFromCamera(this.pointer,this.camera);
            const targets=[...this.pickable,...(this.modelVisible?this.landscape?.children||[]:[])];
            for(const hit of this.raycaster.intersectObjects(targets,true)){
                if(this.cutaway && hit.point.y>28 && this.isCutPart(hit.object))continue;
                let object=hit.object;while(object&&!object.userData.kind)object=object.parent;
                if(object?.userData.kind){this.select(object.userData);break;}
            }
        };
        this.renderer.domElement.addEventListener('pointerdown',this.onDown);this.renderer.domElement.addEventListener('pointerup',this.onUp);
        this.onLost=e=>{e.preventDefault();this.onSelect({title:'3D 显示暂停',text:'请切换二维视图，或刷新页面后重试。'});};this.renderer.domElement.addEventListener('webglcontextlost',this.onLost);
        this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);this.reset();this.animate=this.animate.bind(this);this.frame=requestAnimationFrame(this.animate);
    }
    isCutPart(object){for(let o=object;o;o=o.parent)if(['building-a','work-deck-Z003'].includes(o.name))return true;return false;}
    applyCutaway(){this.landscape?.traverse(o=>{if(o.material && this.isCutPart(o))for(const m of [].concat(o.material)){m.clippingPlanes=this.cutaway?[this.clipPlane]:[];m.clipShadows=true;}});this.renderer.shadowMap.needsUpdate=true;}
    select(info){this.selectedId=info.id;this.onSelect(info);if(info.kind==='model'&&info.anchor){const [x,y,z]=info.anchor;this.controls.target.set(x,y*.45,z);this.camera.position.set(x+160,y+190,z+210);this.controls.update();}}
    reset(){this.controls.target.set(0,10,0);this.camera.position.set(500,560,630);this.controls.update();}
    resize(){const w=this.container.clientWidth,h=this.container.clientHeight;if(!w||!h)return;this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h,false);}
    setVisible(value){this.visible=value;if(value)this.resize();}
    animate(){if(this.disposed)return;this.frame=requestAnimationFrame(this.animate);if(!this.visible)return;this.controls.update();this.renderer.render(this.scene,this.camera);this.layoutLabels();}
    layoutLabels(){
        const w=this.container.clientWidth,h=this.container.clientHeight;
        const items=this.labels.map(l=>{const p=l.anchor.clone().project(this.camera);return {id:l.id,x:(p.x+1)*w/2,y:(1-p.y)*h/2,width:l.width,height:23,priority:l.priority+(l.info.id===this.selectedId?5:0),visible:p.z>-1&&p.z<1&&(l.info.kind!=='model'||this.namesVisible&&this.modelVisible)};});
        const places=placeLabels(items,w,h,70,54);
        this.labels.forEach(l=>{const p=places.get(l.id);l.node.hidden=!p;if(p)l.node.style.transform=`translate(${p.x}px,${p.y}px)`;});
    }
    label(text,anchor,info,priority,color){
        const node=document.createElement('button');node.type='button';node.className='model-label '+info.kind;node.textContent=text;node.style.setProperty('--label-color',color||'#bfd3d3');node.setAttribute('aria-label',`查看${text}`);node.addEventListener('click',()=>this.select(info));
        this.labelLayer.appendChild(node);this.labels.push({id:info.kind+':'+info.id,node,anchor:new THREE.Vector3(...anchor),info,priority,width:Math.min(145,Math.max(55,text.length*12+20))});
    }
    outline(ring,color,y=.25,dashed=false){const points=ring.map(([lng,lat])=>{const [x,z]=worldPoint(lng,lat);return new THREE.Vector3(x,y,z);});const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),dashed?new THREE.LineDashedMaterial({color,dashSize:4,gapSize:3}):new THREE.LineBasicMaterial({color}));line.computeLineDistances();this.root.add(line);}
    addMesh(parent,geometry,color,position){const m=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color,roughness:.65}));m.position.set(...position);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
    worker(p,status,y){
        const [x,z]=worldPoint(p.lng,p.lat),group=new THREE.Group();group.position.set(x,y,z);
        group.userData={kind:'person',id:p.person_id,title:p.person_id,text:`人员 · ${status.label}。采集：${p.timestamp}。模型高度仅为展示示意。`};
        const boot=0x26343c,vest=status.level==='未知'?0x879099:0xf0a947;
        for(const dx of [-.9,.9]){this.addMesh(group,new THREE.BoxGeometry(1.1,2.7,1.3),0x426379,[dx,2.3,0]);this.addMesh(group,new THREE.BoxGeometry(1.4,.8,2.2),boot,[dx,.5,.4]);}
        this.addMesh(group,new THREE.BoxGeometry(3,3.1,1.9),vest,[0,5,0]);
        for(const yBand of [4.2,5.4])this.addMesh(group,new THREE.BoxGeometry(3.1,.28,2),0xe6e9ca,[0,yBand,0]);
        for(const dx of [-2,2]){const arm=this.addMesh(group,new THREE.CapsuleGeometry(.55,2,3,6),vest,[dx,4.7,0]);arm.rotation.z=dx*.13;}
        this.addMesh(group,new THREE.SphereGeometry(1,10,8),0xc39777,[0,7.3,0]);
        this.addMesh(group,new THREE.SphereGeometry(1.25,12,8,0,Math.PI*2,0,Math.PI/2),0xffc65b,[0,7.5,0]);this.addMesh(group,new THREE.CylinderGeometry(1.45,1.45,.2,12),0xffc65b,[0,7.5,0]);
        const ring=new THREE.Mesh(new THREE.RingGeometry(2.7,3.3,20),new THREE.MeshBasicMaterial({color:status.color,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.y=.16;group.add(ring);
        this.root.add(group);this.pickable.push(group);this.label(p.person_id,[x,y+10,z],group.userData,3,status.color);
    }
    device(d,status,y){
        const [x,z]=worldPoint(...d.location),group=new THREE.Group();group.position.set(x,y,z);group.userData={kind:'device',id:d.device_id,title:`${d.device_id} ${d.device_type}`,text:`${status.label} · ${d.alert}。负荷${d.load}% / 温度${d.temperature}℃ / 漏电${d.leakage}mA`};
        if(d.device_type==='电缆'){
            const spool=this.addMesh(group,new THREE.CylinderGeometry(2.3,2.3,4.5,12),0x3c4f5d,[0,3,0]);spool.rotation.z=Math.PI/2;
            for(const dx of [-2.4,2.4]){const end=this.addMesh(group,new THREE.CylinderGeometry(3,3,.45,12),0xa58b5f,[dx,3,0]);end.rotation.z=Math.PI/2;}
        }else{
            this.addMesh(group,new THREE.BoxGeometry(5.3,6.5,3.2),0x77949c,[0,4.2,0]);this.addMesh(group,new THREE.BoxGeometry(4.8,5.8,.22),0xc2c7bf,[0,4.2,1.8]);
            this.addMesh(group,new THREE.BoxGeometry(1.2,1.8,.28),0x273d46,[-.9,5.5,2]);this.addMesh(group,new THREE.BoxGeometry(.24,1.5,.35),0x445460,[1.5,3.6,2]);
            this.addMesh(group,new THREE.BoxGeometry(5.9,.5,3.8),0x54717c,[0,7.7,0]);
            for(const dx of [-1.8,1.8])this.addMesh(group,new THREE.BoxGeometry(.6,1.6,.8),0x455966,[dx,.8,0]);
            this.addMesh(group,new THREE.SphereGeometry(.5,8,6),status.color,[1.3,6.2,2]);
        }
        const ring=new THREE.Mesh(new THREE.RingGeometry(3.4,4,20),new THREE.MeshBasicMaterial({color:status.color,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.y=.14;group.add(ring);
        this.root.add(group);this.pickable.push(group);this.label(d.device_id,[x,y+10,z],group.userData,2,status.color);
    }
    update(data){
        this.data=data;disposeGroup(this.root);this.pickable=[];this.labels=[];this.labelLayer.replaceChildren();
        const features=data.zones?.features||[],key=JSON.stringify(features);
        if(key!==this.landscapeKey){if(this.landscape){this.scene.remove(this.landscape);disposeGroup(this.landscape);}this.landscape=buildLandscape(features);this.landscapeKey=key;this.landscape.visible=this.modelVisible;this.scene.add(this.landscape);this.applyCutaway();}
        for(const part of this.landscape.userData.parts){if(['yard','perimeter','site-services'].includes(part.userData.id))continue;this.label(part.userData.title,part.userData.anchor,part.userData,0,'#b9d1d0');}
        const {colors,deviceState,personState}=window.SiteUI;
        for(const f of data.visibility?.zones===false?[]:features){
            const b=zoneBounds(f),color=colors[f.properties.risk_level]||colors['未知'];const y=f.properties.zone_type==='基坑'?-9.85:.25;
            const info={kind:'zone',id:f.properties.zone_id,title:`${f.properties.zone_id} ${f.properties.zone_type}`,text:`${f.properties.risk_level}风险；缓冲距离${f.properties.buffer_radius}米。区域平面取自 GIS；模型高度为演示示意。`};
            for(const rings of ringsOf(f)){
                const path=(ring,Type)=>{const p=new Type();ring.forEach(([lng,lat],i)=>{const [x,z]=worldPoint(lng,lat);i?p.lineTo(x,-z):p.moveTo(x,-z);});return p;};const shape=path(rings[0],THREE.Shape);shape.holes=rings.slice(1).map(r=>path(r,THREE.Path));
                const mesh=new THREE.Mesh(new THREE.ShapeGeometry(shape),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.15,depthWrite:false,side:THREE.DoubleSide}));mesh.rotation.x=-Math.PI/2;mesh.position.y=y;mesh.userData=info;mesh.renderOrder=2;this.root.add(mesh);this.pickable.push(mesh);this.outline(rings[0],color,.35);
            }
            this.label(`${f.properties.zone_id} · ${f.properties.zone_type}`,[b.minX,6,b.minZ],info,1,color);
        }
        for(const f of data.visibility?.buffers===false?[]:data.buffers?.features||[])for(const rings of ringsOf(f))for(const ring of rings)this.outline(ring,0x97a9ae,.28,true);
        const results=new Map((data.spatial?.results||[]).map(r=>[r.person_id,r]));
        for(const p of data.visibility?.people===false?[]:data.spatial?.people||[])this.worker(p,personState(p,results.get(p.person_id)),surfaceHeight(p.lng,p.lat,features));
        for(const d of data.visibility?.devices===false?[]:data.devices||[])this.device(d,deviceState(d),surfaceHeight(...d.location,features));
        if(data.visibility?.route!==false&&data.route?.length>1)this.outline(data.route,0xb994ff,.5,true);
        this.renderer.shadowMap.needsUpdate=true;this.layoutLabels();
    }
    focus(lng,lat){const [x,z]=worldPoint(lng,lat),y=surfaceHeight(lng,lat,this.data?.zones?.features);this.controls.target.set(x,y+3,z);this.camera.position.set(x+125,y+160,z+190);this.controls.update();}
    dispose(){this.disposed=true;cancelAnimationFrame(this.frame);this.resizeObserver.disconnect();this.controls.dispose();disposeGroup(this.root);if(this.landscape)disposeGroup(this.landscape);this.sun.shadow.map?.dispose();this.renderer.dispose();this.renderer.domElement.remove();this.labelLayer.remove();this.toolbar.remove();this.modelNote.remove();}
}
