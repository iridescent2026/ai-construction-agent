import * as THREE from 'three';
import {OrbitControls} from './vendor/three/OrbitControls.js';
import {GLTFLoader} from './vendor/three/GLTFLoader.js';
import {SceneMarkers} from './scene-markers.mjs';
import {placeLabels} from './scene-layout.mjs';
import {layoutSectionLabels} from './factory-section-layout.mjs';
import {buildFactorySite,updateFactorySite} from './factory-site-model.mjs';
import {buildFactory,VIEWS} from './factory-model.mjs';
import {DEMO_PATHS} from './factory-safety.mjs';
import {watchFactory,factoryRequest,measurementText,freshFactory} from './factory-client.mjs';
let stopSubscription,serverState,connected=false;
const embedded=window.parent!==window&&new URLSearchParams(location.search).has('embed');
const referenceArea=new URLSearchParams(location.search).get('referenceArea');

const $=id=>document.getElementById(id),stage=$('factory-stage');
const VIEW_CONFIG={...VIEWS,overview:{...VIEWS.overview,camera:[-145,215,70]},section:{title:'厂区整体剖面 · A 装配 / B 动力',subtitle:'两座厂房同时剖开 · 内外轮廓一致 · 不显示编号标识点',camera:[-160,240,100],target:[0,3,0]}};
const siteModels=new Map(),areaLabels=[];let areaLabelLayer;
const assets=new Map(),cache=new Map();let scene,renderer,camera,controls,markers,root,current='overview',selected=null,preview=null,frame,disposed=false,ready=false;
let snapshot={active:[],events:[],added:[]};
const layers={device:true,person:true,zone:true},lights={};
let gisRoute,routeKey='';
function drawGisRoute(points=[],origin){if(!cache.has('overview')||!origin)return;const key=JSON.stringify(points);if(key===routeKey)return;routeKey=key;if(gisRoute){gisRoute.removeFromParent();gisRoute.geometry.dispose();gisRoute.material.dispose();gisRoute=null;}if(points.length<2)return;const positions=points.map(([lng,lat])=>new THREE.Vector3((lng-origin[0])*111320*Math.cos(origin[1]*Math.PI/180),.9,(origin[1]-lat)*111320));gisRoute=new THREE.Line(new THREE.BufferGeometry().setFromPoints(positions),new THREE.LineDashedMaterial({color:0xe8b95b,dashSize:2,gapSize:1}));gisRoute.computeLineDistances();cache.get('overview').add(gisRoute);}
function detail(info){preview=info;paintDetail();}
function paintDetail(){
    const info=preview||selected;$('factory-detail').hidden=!info;if(!info)return;
    $('factory-detail').classList.toggle('risk-detail',info.riskState==='danger');$('detail-id').textContent=info.id;$('detail-name').textContent=info.title;
    const risk=info.riskState==='danger'?`进入危险区域：${info.currentZones.join('、')}。`:info.riskState==='unknown'?'位置未知，保留上次区域记录。':info.riskState==='clear'?'当前未进入限制区域。':'';
    const position=(info.kind==='person'||info.mobile)&&Number.isFinite(info.anchor[0])&&Number.isFinite(info.anchor[2])?`场景位置：${info.anchor[0].toFixed(1)} m / ${info.anchor[2].toFixed(1)} m。`:'';
    const source=info.positionSource==='telemetry'?'接口定位':'演示定位',observed=info.positionTimestamp?`采集 ${new Date(info.positionTimestamp).toLocaleTimeString('zh-CN',{hour12:false})} · ${source}。`:'';
    $('detail-description').textContent=(!connected&&stopSubscription?'后台断连，以下为最后观测。':'')+risk+position+(info.kind==='device'?measurementText(info)+'。':'')+observed+info.text.replace('（模拟位置）','').replace('本地模拟位置，','');
}
function entities(model=root){return [...(model.userData.locations||[]),...(model.userData.devices||[]),...(model.userData.people||[]),...(model.userData.zones||[])];}
function catalog(){return [...cache.values()].flatMap(model=>entities(model)).filter(info=>info.kind!=='model');}
function markerTitle(info){return info.title.startsWith(info.id+' ·')?info.title:`${info.id} · ${info.title}`;}
function markerColor(info){return info.riskState==='unknown'?'#98a1ac':info.riskState==='danger'?'#ff6868':info.kind==='zone'?'#f18e65':info.kind==='person'?'#66d4b3':'#e8ac42';}
function visibleEntities(){return (['overview','section'].includes(current)?[]:entities()).filter(info=>layers[info.kind]!==false);}
function refreshMarkers(){
    if(!root||!markers)return;markers.begin();for(const info of visibleEntities()){const record=markers.set(info.id,markerTitle(info),info,markerColor(info));record.node.classList.toggle('selected',info.id===selected?.id);record.node.classList.toggle('danger',info.riskState==='danger');}markers.end();
}
function evaluateSafety(){
    if(siteModels.has('section'))updateFactorySite(siteModels.get('section'),serverState,layers);
    refreshMarkers();paintDetail();
    for(const model of cache.values())for(const zone of model.userData.zones){const fill=model.getObjectByName(zone.id).children[0],occupied=snapshot.active.some(a=>a.zoneId===zone.id);fill.material.color.set(occupied?'#e76958':'#d77252');fill.material.opacity=occupied?.23:.14;}
    const currentAlerts=snapshot.active.filter(item=>item.view===current),banner=$('scene-alert');
    if(banner){banner.hidden=!currentAlerts.length;banner.textContent=`⚠ ${currentAlerts.length} 条区域进入报警 · ${currentAlerts.map(item=>`${item.entityId} → ${item.zoneId}`).join(' / ')}`;}
    window.dispatchEvent(new CustomEvent('factory-safety-update',{detail:snapshot}));
}
function moveEntity(id,x,z,updateShadow=true){
    const info=catalog().find(i=>i.id===id);if(!info||info.kind!=='person'&&!info.mobile||!Number.isFinite(x)||!Number.isFinite(z))return false;
    const object=cache.get(info.view).getObjectByName(id);object.position.x=x;object.position.z=z;info.anchor[0]=x;info.anchor[2]=z;if(updateShadow)renderer.shadowMap.needsUpdate=true;return true;
}
function stopDemo(){return commandDemo('stop');}
function startDemo(key){if(!DEMO_PATHS[key]||!ready)return false;switchView(DEMO_PATHS[key].view);return commandDemo('start',key);}
function resetDemo(){return commandDemo('reset');}
function select(info){
    if(info.kind==='model'){switchView(info.view);return;}
    if(info.view!==current)switchView(info.view);
    selected=info;preview=null;paintDetail();
    for(const record of markers.records.values())record.node.classList.toggle('selected',record.id===info.id);
    window.dispatchEvent(new CustomEvent('factory-select',{detail:info}));
}
$('factory-close').addEventListener('click',()=>{selected=null;markers?.clearPreview();preview=null;paintDetail();for(const record of markers?.records.values()||[])record.node.classList.remove('selected');window.dispatchEvent(new CustomEvent('factory-select',{detail:null}));});
function fitView(){
    if(!root)return;
    const config=VIEW_CONFIG[current],direction=new THREE.Vector3(...config.camera).sub(new THREE.Vector3(...config.target)).normalize();
    const pure=['overview','section'].includes(current),margin=current==='section'?0:10,box=pure?new THREE.Box3().setFromPoints(root.userData.boundaryPoints.flatMap(([x,z])=>[new THREE.Vector3(x-margin,0,z-margin),new THREE.Vector3(x+margin,15,z+margin)])):new THREE.Box3().setFromObject(root),target=pure?box.getCenter(new THREE.Vector3()):new THREE.Vector3(...config.target),right=new THREE.Vector3(0,1,0).cross(direction).normalize(),up=direction.clone().cross(right).normalize();
    const vertical=THREE.MathUtils.degToRad(camera.fov/2),horizontal=Math.atan(Math.tan(vertical)*camera.aspect);
    const corners=[];for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])corners.push(new THREE.Vector3(x,y,z));
    let distance=0;
    for(let step=0;step<4;step++){
        distance=0;for(const point of corners){const offset=point.clone().sub(target),depth=offset.dot(direction);distance=Math.max(distance,depth+Math.abs(offset.dot(right))/(Math.tan(horizontal)*.89),depth+Math.abs(offset.dot(up))/(Math.tan(vertical)*.82));}
        camera.position.copy(target).addScaledVector(direction,distance);camera.lookAt(target);camera.updateMatrixWorld();
        if(step===3)break;const projected=corners.map(p=>p.clone().project(camera));
        const cx=(Math.min(...projected.map(p=>p.x))+Math.max(...projected.map(p=>p.x)))/2,cy=(Math.min(...projected.map(p=>p.y))+Math.max(...projected.map(p=>p.y)))/2+.035;
        target.addScaledVector(right,cx*distance*Math.tan(horizontal)).addScaledVector(up,cy*distance*Math.tan(vertical));
    }
    controls.enableDamping=false;controls.target.copy(target);controls.update();controls.enableDamping=true;
    controls.minDistance=['overview','section'].includes(current)?65:17;controls.maxDistance=['overview','section'].includes(current)?800:230;
}
function resize(){const w=stage.clientWidth,h=stage.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();if(ready&&root)fitView();}
function switchView(view){
    if(!VIEW_CONFIG[view]||!ready)return;
    markers.clearPreview();selected=null;preview=null;paintDetail();if(root)scene.remove(root);current=view;
    root=siteModels.get(view)||cache.get(view);scene.add(root);
    const pure=['overview','section'].includes(view);stage.dataset.siteView=view==='overview'?'exterior':view==='section'?'section':'interior';
    document.querySelectorAll('.scene-legend').forEach(n=>n.hidden=pure);
    areaLabelLayer.replaceChildren();areaLabels.length=0;for(const area of root.userData.areaLabels||[]){const n=document.createElement('div');n.className='section-area-label '+area.view;const title=document.createElement('strong'),note=document.createElement('small');title.textContent=area.title;note.textContent=area.note;n.append(title,note);areaLabelLayer.append(n);areaLabels.push({node:n,anchor:area.anchor});}
    const footer=stage.querySelector('.scene-footer span');if(footer)footer.textContent=pure?'拖动旋转 · 滚轮缩放 · 选择工区查看内部':'拖动旋转 · 滚轮缩放 · 悬停图标查看名称';
    document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.view===view));
    $('scene-title').textContent=VIEW_CONFIG[view].title;$('view-code').textContent=view==='overview'?'EXTERIOR':view==='section'?'CAMPUS CUTAWAY':`WORK AREA / ${view.toUpperCase()}`;$('scene-caption').textContent=VIEW_CONFIG[view].subtitle;
    $('directory-title').textContent=pure?'园区功能分区':'危险设备与装置';$('directory-note').textContent=pure?'全景与剖面共用厂房轮廓；选择分区进入内部。':`${root.userData.devices.length} 处巡检对象 · ${root.userData.workerCount} 位示意人员。悬停图标显示中文名称。`;
    const infos=pure?[{id:'A',kind:'model',view:'a',title:'装配制造 · 西侧厂房'},{id:'B',kind:'model',view:'b',title:'动力设备 · 东侧厂房与控制侧翼'}]:entities();refreshMarkers();
    $('equipment-directory').replaceChildren();for(const info of infos){const b=document.createElement('button'),code=document.createElement('span'),name=document.createElement('strong');code.textContent=info.id;name.textContent=info.title;b.append(code,name);b.addEventListener('click',()=>select(info));$('equipment-directory').appendChild(b);}
    fitView();renderer.shadowMap.needsUpdate=true;
    scene.background.set(current==='b'?'#172530':'#20343e');if(lights.ambient)lights.ambient.intensity=current==='b'?1.8:2.2;if(lights.sun)lights.sun.intensity=current==='b'?2.5:3.3;
    const banner=$('scene-alert');if(banner){const alerts=snapshot.active.filter(item=>item.view===current);banner.hidden=!alerts.length;banner.textContent=`⚠ ${alerts.length} 条区域进入报警 · ${alerts.map(item=>`${item.entityId} → ${item.zoneId}`).join(' / ')}`;}
    window.dispatchEvent(new CustomEvent('factory-view-change',{detail:{view}}));
    window.dispatchEvent(new CustomEvent('factory-select',{detail:null}));
}
function layout(){
    const w=stage.clientWidth,h=stage.clientHeight,infos=visibleEntities();
    const items=infos.map(info=>{const p=new THREE.Vector3(...info.anchor).project(camera);return{id:info.id,x:(p.x+1)*w/2,y:(1-p.y)*h/2,width:22,height:22,priority:info.id===selected?.id?4:1,visible:p.z>-1&&p.z<1};});
    markers.layout(placeLabels(items,w,h,43,54),w,h);
    layoutSectionLabels(areaLabels,camera,w,h);
}
function render(){if(disposed)return;frame=requestAnimationFrame(render);controls.update();renderer.render(scene,camera);layout();}
async function start(){
    scene=new THREE.Scene();scene.background=new THREE.Color('#1d3039');scene.fog=new THREE.Fog('#1d3039',500,950);
    camera=new THREE.PerspectiveCamera(40,1,.1,1200);renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.3;
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;stage.prepend(renderer.domElement);
    controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.maxPolarAngle=Math.PI*.47;controls.enablePan=true;
    lights.ambient=new THREE.HemisphereLight(0xddeef0,0x475451,2.2);scene.add(lights.ambient);
    const sun=new THREE.DirectionalLight(0xffe8c8,3.3);sun.position.set(-70,140,70);sun.castShadow=true;sun.shadow.mapSize.set(4096,4096);Object.assign(sun.shadow.camera,{left:-105,right:105,top:105,bottom:-105,near:1,far:320});sun.shadow.normalBias=.1;sun.shadow.bias=-.0003;scene.add(sun);
    lights.sun=sun;
    const fill=new THREE.DirectionalLight(0xa8c7e0,1.1);fill.position.set(80,70,-90);scene.add(fill);
    areaLabelLayer=document.createElement('div');areaLabelLayer.className='section-area-labels';stage.append(areaLabelLayer);markers=new SceneMarkers(stage,select,detail);resize();new ResizeObserver(resize).observe(stage);
    const loader=new GLTFLoader(),names=['building-a.glb','building-k.glb','building-r.glb','tank.glb','pipe.glb','barrel.glb','pallet.glb','railing.glb','industrial-pipes.gltf','wall-vent.glb'];
    const loaded=await Promise.allSettled(names.map(async name=>{const gltf=await loader.loadAsync(`assets/factory/${name}`);assets.set(name,gltf.scene);}));
    const failures=loaded.filter(r=>r.status==='rejected').length;
    $('asset-status').textContent=`${assets.size} / ${names.length} 开源资产已载入`;
    if(failures)$('scene-error').textContent=`${failures} 个资产未载入，已使用补充几何模型。刷新页面可重试。`;
    for(const view of Object.keys(VIEWS))cache.set(view,buildFactory(view,assets));
    const [site,siteLayout]=await Promise.all(['reference-site.json','factory-plan.geojson'].map(async name=>{const response=await fetch('assets/factory/'+name);if(!response.ok)throw new Error('厂区轮廓加载失败');return response.json();}));
    siteModels.set('overview',buildFactorySite(site,siteLayout,assets));siteModels.set('section',buildFactorySite(site,siteLayout,assets,{cutaway:true}));
    for(const info of catalog())if(info.kind==='person'||info.mobile){info.riskState='unknown';info.currentZones=[];}
    ready=true;switchView(embedded&&['a','b'].includes(referenceArea)?referenceArea:'overview');$('loading').hidden=true;render();
    window.FactoryTwin={
        catalog,safetySnapshot:()=>snapshot,startDemo,stopDemo,resetDemo,switchView,
        async updatePosition(id,{x,z}){const data=await factoryRequest('/observations',{observations:[{id,x,z}]});applyState(data);return true;},
        setLayer(kind,enabled){if(!(kind in layers))return;layers[kind]=enabled;for(const model of cache.values())for(const info of entities(model))if(info.kind===kind)model.getObjectByName(info.id).visible=enabled;updateFactorySite(siteModels.get('section'),serverState,layers);refreshMarkers();},
        locate(id){const info=catalog().find(item=>item.id===id);if(!info)return false;if(layers[info.kind]===false){this.setLayer(info.kind,true);window.dispatchEvent(new CustomEvent('factory-layer-change',{detail:{kind:info.kind,enabled:true}}));}select(info);document.querySelector('.scene-card').scrollIntoView({behavior:'smooth',block:'start'});return true;}
    };
    evaluateSafety();
    window.dispatchEvent(new Event('factory-ready'));
    if(embedded){stopSubscription=()=>{};window.parent.postMessage({type:'factory-frame-ready'},location.origin);}else stopSubscription=watchFactory(applyState,disconnect);
    $('data-refresh')?.addEventListener('click',async()=>{try{applyState(await factoryRequest());}catch(error){disconnect(error);}});
    // Raycast body selection is supplementary; labels remain the primary hover target.
    let down;renderer.domElement.addEventListener('pointerdown',e=>down=[e.clientX,e.clientY]);
    renderer.domElement.addEventListener('pointerup',e=>{
        if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;
        const rect=renderer.domElement.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),camera);
        for(const hit of ray.intersectObject(root,true)){
            let hidden=false;for(let o=hit.object;o;o=o.parent)if(!o.visible)hidden=true;if(hidden)continue;
            let o=hit.object;while(o&&!o.userData.kind&&!o.userData.info)o=o.parent;if(o?.userData.info?.workArea){switchView(o.userData.info.workArea);break;}if(o?.userData.kind){select(o.userData);break;}
        }
    });
}
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
$('factory-reset').addEventListener('click',()=>{markers?.clearPreview();fitView();});
$('factory-export').addEventListener('click',()=>{
    if(!renderer||!root)return;
    // Render a 16:9 deliverable independently of the dashboard window size.
    const width=1600,height=900,size=renderer.getSize(new THREE.Vector2()),pixelRatio=renderer.getPixelRatio(),oldAspect=camera.aspect,oldPosition=camera.position.clone(),oldTarget=controls.target.clone();
    renderer.setPixelRatio(1);renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();fitView();renderer.render(scene,camera);
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');ctx.drawImage(renderer.domElement,0,0);
    const infos=visibleEntities();
    const places=placeLabels(infos.map(info=>{const p=new THREE.Vector3(...info.anchor).project(camera);return{id:info.id,x:(p.x+1)*width/2,y:(1-p.y)*height/2,width:22,height:22,priority:1,visible:p.z>-1&&p.z<1};}),width,height,80,45);
    for(const area of root.userData.areaLabels||[]){const p=new THREE.Vector3(...area.anchor).project(camera);ctx.fillStyle='#142a32';ctx.fillRect((p.x+1)*width/2-72,(1-p.y)*height/2-30,160,38);ctx.fillStyle='#f5ead2';ctx.font="600 18px 'Microsoft YaHei',sans-serif";ctx.fillText(area.title,(p.x+1)*width/2-62,(1-p.y)*height/2-5);}
    renderer.setPixelRatio(pixelRatio);renderer.setSize(size.x,size.y,false);camera.aspect=oldAspect;camera.updateProjectionMatrix();controls.enableDamping=false;camera.position.copy(oldPosition);controls.target.copy(oldTarget);controls.update();controls.enableDamping=true;
    ctx.fillStyle='#dbe6e2';ctx.font="500 28px 'Microsoft YaHei',sans-serif";ctx.fillText(VIEW_CONFIG[current].title,30,43);
    ctx.fillStyle='#a8bdc2';ctx.font="16px 'Microsoft YaHei',sans-serif";ctx.fillText(VIEW_CONFIG[current].subtitle,30,73);
    for(const info of infos){const p=places.get(info.id);if(!p)continue;ctx.fillStyle=markerColor(info);ctx.strokeStyle='#f3f7ed';ctx.lineWidth=1;ctx.save();ctx.translate(p.x+11,p.y+11);ctx.beginPath();if(info.kind==='person')ctx.arc(0,0,4,0,Math.PI*2);else{if(info.kind==='zone')ctx.rotate(Math.PI/4);ctx.rect(-3,-3,6,6);}ctx.fill();ctx.stroke();ctx.restore();}
    const exportInfo=markers.active?.info||selected;
    if(exportInfo){const p=places.get(exportInfo.id);if(p){ctx.font="600 18px 'Microsoft YaHei',sans-serif";const text=exportInfo.title,w=ctx.measureText(text).width+24,x=Math.max(5,Math.min(width-w-5,p.x+11-w/2)),y=Math.max(90,p.y-42);ctx.fillStyle='#142a32';ctx.strokeStyle='#91aaa7';ctx.beginPath();ctx.roundRect(x,y,w,34,4);ctx.fill();ctx.stroke();ctx.fillStyle='#f5ead2';ctx.fillText(text,x+12,y+23);}}
    ctx.fillStyle='#94afb4';ctx.font="14px 'Microsoft YaHei',sans-serif";ctx.fillText('工安智瞳 · 工厂场景设计示意',30,height-25);
    const url=canvas.toDataURL('image/png');$('export-image').src=url;$('export-download').href=url;$('export-download').download=`工厂场景-${current}.png`;$('image-export').showModal();
});
$('export-close').addEventListener('click',()=>$('image-export').close());
window.addEventListener('pagehide',event=>{if(event.persisted)return;disposed=true;stopSubscription?.();cancelAnimationFrame(frame);controls?.dispose();markers?.dispose();const geometries=new Set(),materials=new Set(),textures=new Set();for(const object of [...cache.values(),...siteModels.values(),...assets.values()])object.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of [].concat(o.material||[])){materials.add(m);for(const value of Object.values(m))if(value?.isTexture)textures.add(value);}if(o.isInstancedMesh)o.dispose();});geometries.forEach(g=>g.dispose());textures.forEach(t=>t.dispose());materials.forEach(m=>m.dispose());renderer?.dispose();});
function applyState(data){
    if(!ready||!data.entities)return;serverState=data;connected=true;
    const byId=new Map(catalog().map(info=>[info.id,info]));
    for(const record of data.entities){const info=byId.get(record.id);if(!info)continue;if(info.kind==='person'||info.mobile)moveEntity(info.id,record.anchor[0],record.anchor[2],false);for(const key of ['riskState','currentZones','positionSource','positionTimestamp','measurements','measurementSource','measurementTimestamp'])info[key]=record[key];}
    snapshot={active:data.active,events:data.events,added:[],people:26};
    stage.dataset.revision=data.revision;renderer.shadowMap.needsUpdate=true;evaluateSafety();
    window.dispatchEvent(new CustomEvent('factory-data-update',{detail:data}));
    window.dispatchEvent(new CustomEvent('factory-demo-change',{detail:{running:!!data.demo,key:data.demo?.key,id:data.demo?.id}}));
    updateConnection();
}
function updateConnection(error){
    $('live-strip')?.classList.toggle('disconnected',!connected);
    if($('live-status'))$('live-status').textContent=connected?'● 工厂后台已连接 · 自动同步':'● 数据断连 · 当前状态未知';
    if($('live-time'))$('live-time').textContent=serverState?`版本 ${serverState.revision} / ${new Date(serverState.updatedAt).toLocaleTimeString('zh-CN',{hour12:false})}`:'等待首帧数据';
    if($('live-source')){const actual=serverState?.entities.filter(e=>e.positionSource==='telemetry'||e.measurementSource==='telemetry').length||0;$('live-source').textContent=actual?`${actual} 个接口上报实体 · 其余为后台演示`:'后台演示数据 · 未接现场传感器';}
    $('asset-status').textContent=connected?`${assets.size} / 10 资产 · 同源观测 v${serverState.revision}`:'后台断连 · 保留最后模型';
    if(error&&$('home-status'))$('home-status').textContent=error.message;
}
function disconnect(error){connected=false;for(const info of catalog())if(info.kind==='person'||info.mobile)info.riskState='unknown';snapshot={...snapshot,active:snapshot.active.map(a=>({...a,state:'unknown'}))};evaluateSafety();updateConnection(error);window.dispatchEvent(new CustomEvent('factory-data-offline'));}
async function commandDemo(action,key){try{applyState(await factoryRequest('/demo',{action,key:key||'overview'}));return true;}catch(error){if($('home-status'))$('home-status').textContent=error.message;return false;}}
window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==window.parent||e.data?.type!=='factory-gis'||!ready)return;const msg=e.data;if(msg.action==='route')drawGisRoute(msg.points,msg.origin);if(msg.action==='state'){if(msg.data)applyState(msg.data);else disconnect(new Error('GIS 工厂后台断连'));}if(msg.action==='locate')window.FactoryTwin.locate(msg.id);if(msg.action==='clear'){$('factory-close').click();}if(msg.action==='reset'){switchView('overview');fitView();}if(msg.action==='layers')for(const [kind,key]of [['person','people'],['device','devices'],['zone','zones']])window.FactoryTwin.setLayer(kind,msg.visibility[key]!==false);});
window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==window.parent||e.data?.type!=='factory-gis'||!ready)return;if(e.data.action==='reference-reset'&&embedded&&['a','b'].includes(referenceArea)){switchView(referenceArea);fitView();}});
start().catch(error=>{$('loading').textContent='三维场景加载失败，请刷新重试。';$('scene-error').textContent=error.message;console.error(error);});
