const API_BASE=window.APP_CONFIG?.gis || 'http://127.0.0.1:8000';
const ELECTRICAL_API=window.APP_CONFIG?.electrical || 'http://127.0.0.1:8001';
const AGENT_API=window.APP_CONFIG?.agent || 'http://127.0.0.1:8002';
const {colors,escape:escapeHtml,deviceState,personState}=window.SiteUI;
const $=id=>document.getElementById(id);
const state={zones:null,buffers:null,spatial:null,devices:null,snapshot:null,route:[],mode:'2d',visibility:{zones:true,buffers:true,people:true,devices:true,route:true}};
let scene=null,sceneLoading=null,deviceBusy=false,spatialBusy=false,simulationBusy=false,lastFreshness='';
let factoryBusy=false;
const map=L.map('map',{zoomControl:true,minZoom:12,maxZoom:21}).setView([30.293,120.008],17);
const base=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Esri World Imagery'});
const zoneLayer=L.geoJSON(null,{style:f=>({color:colors[f.properties.risk_level],weight:2,fillOpacity:0.18}),
    onEachFeature:(f,layer)=>layer.bindPopup(`<b>${escapeHtml(f.properties.zone_id)} ${escapeHtml(f.properties.zone_type)}</b><br>缓冲距离 ${f.properties.buffer_radius} 米`)}).addTo(map);
const bufferLayer=L.geoJSON(null,{style:()=>({color:'#61778e',weight:1,dashArray:'5 4',fillOpacity:0.035})}).addTo(map);
const personLayer=L.layerGroup().addTo(map),deviceLayer=L.layerGroup().addTo(map),routeLayer=L.layerGroup().addTo(map);
const layers={zones:zoneLayer,buffers:bufferLayer,people:personLayer,devices:deviceLayer,route:routeLayer};
document.querySelectorAll('[data-layer]').forEach(input=>input.addEventListener('change',()=>{
    const key=input.dataset.layer;state.visibility[key]=input.checked;
    input.checked?layers[key].addTo(map):map.removeLayer(layers[key]);syncScene();
}));
L.control.scale({imperial:false,position:'bottomleft'}).addTo(map);
let satellite=false;
base.on('tileerror',()=>notice('卫星影像暂时不可用；示意图、业务图层及 3D 场景不受影响。'));

function notice(message){$('notice').textContent=message;$('notice').hidden=!message;}
function status(id,message,ok){$(id).textContent=message;$(id).className=ok?'status-ok':'status-bad';}
function localTime(value){const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleTimeString('zh-CN',{hour12:false}):'时间未知';}
async function request(url,options={}){
    const response=await fetch(url,{...options,signal:AbortSignal.timeout(12000)});
    if(!response.ok){let message=`请求失败（${response.status}）`;try{const body=await response.json();if(typeof body.detail==='string')message=body.detail;}catch{}throw new Error(message);}
    return response.json();
}
function icon(kind,color){return L.divIcon({className:`map-pin ${kind}`,html:`<span style="--pin:${color}"></span>`,iconSize:[15,15],iconAnchor:[7.5,7.5]});}
let selectedDetail=null,previewDetail=null;
function renderDetail(){const info=previewDetail||selectedDetail;$('scene-detail').hidden=!info||!!window.FACTORY_WORKBENCH&&state.mode==='3d';if(info)$('detail-content').innerHTML=`<h3>${escapeHtml(info.title)}</h3><p>${escapeHtml(info.text)}</p>`;}
function showDetail(info){selectedDetail=info;previewDetail=null;renderDetail();}
function previewDetailFor(info){previewDetail=info;renderDetail();}
$('close-detail').addEventListener('click',()=>{selectedDetail=null;previewDetail=null;scene?.markers.clearPreview();renderDetail();});
function syncScene(){scene?.update(state);window.SiteManagement?.render();}
function counts(){
    $('metric-zones').textContent=state.zones?.features.length??'—';
    const people=state.spatial?.people;
    const current=people?.filter(p=>window.SiteUI.fresh(p));
    $('metric-people').textContent=current?.length??'—';
    $('people-note').textContent=people?`登记 ${people.length} 人 · 过期 ${people.length-current.length} 人`:'空间数据未知';
    $('metric-high').textContent=window.FACTORY_WORKBENCH?(state.factoryData?.active.filter(a=>a.state!=='unknown').length??'—'):(state.devices?.filter(d=>deviceState(d).level==='高').length??'—');
    $('metric-unknown').textContent=people && state.devices ? people.length-current.length+state.devices.filter(d=>deviceState(d).level==='未知').length:'—';
}
function resetView(){if(state.mode==='3d')scene?.reset();else if(state.zones)map.fitBounds(zoneLayer.getBounds(),{padding:[40,40]});}
async function setMode(mode){
    if(mode==='3d'){
        try{
            if(!scene){
                if(!sceneLoading)sceneLoading=import(window.FACTORY_WORKBENCH?'./factory-gis-scene.mjs?v=1':'./construction-scene.js?v=7').then(({SiteScene})=>{scene=new SiteScene($('scene3d'),showDetail,previewDetailFor);scene.update(state);return scene;});
                await sceneLoading;
            }
        }catch(error){sceneLoading=null;notice('当前设备无法启动 3D，已保留二维视图。可刷新后重试。');return;}
    }
    state.mode=mode;
    $('map').hidden=mode!=='2d';$('scene3d').hidden=mode!=='3d';
    $('view-2d').classList.toggle('active',mode==='2d');$('view-3d').classList.toggle('active',mode==='3d');
    $('view-2d').setAttribute('aria-pressed',mode==='2d');$('view-3d').setAttribute('aria-pressed',mode==='3d');
    $('basemap').hidden=mode==='3d';$('compass').hidden=mode==='3d';
    $('view-note').textContent=mode==='3d'?'悬停图标看编码与详情 · 圆点为人员，方块为建筑 / 设备 · 拖动旋转':'圆点为人员，方块为设备；点击对象可查看详情。';
    $('view-help').textContent=mode==='3d'?'3D 为空间关系示意；建筑、塔吊及人员模型均为设计示意，非现场实测。两种视图共享同一观测数据。':'坐标与业务图层可离线查看。卫星影像需要联网。';
    scene?.setVisible(mode==='3d');if(mode==='2d')map.invalidateSize();
}
$('view-2d').addEventListener('click',()=>setMode('2d'));
$('view-3d').addEventListener('click',()=>setMode('3d'));
$('reset-view').addEventListener('click',resetView);
$('basemap').addEventListener('click',()=>{satellite=!satellite;satellite?base.addTo(map):map.removeLayer(base);$('basemap').setAttribute('aria-pressed',satellite);$('basemap').textContent=satellite?'关闭底图':'卫星底图';});

async function loadZones(){
    if(window.FACTORY_WORKBENCH)return loadFactory();
    try{const [zones,buffers]=await Promise.all([request(`${API_BASE}/zones.geojson`),request(`${API_BASE}/buffers.geojson`)]);
        state.zones=zones;state.buffers=buffers;zoneLayer.clearLayers().addData(zones);bufferLayer.clearLayers().addData(buffers);resetView();syncScene();counts();
    }catch(error){notice('区域及缓冲图层未加载，请检查空间服务后点击刷新。');}
}
function renderSpatial(){
    personLayer.clearLayers();
    if(!state.spatial){$('zone-list').textContent='无法读取人员及区域数据。';counts();syncScene();return;}
    const data=state.spatial,byId=new Map(data.results.map(r=>[r.person_id,r]));
    const awaitingFreshCounts=data.people.some(p=>p.fresh!==undefined && p.fresh!==window.SiteUI.fresh(p));
    data.people.forEach(p=>{
        const r=byId.get(p.person_id),view=personState(p,r);
        L.marker([p.lat,p.lng],{icon:icon('person',view.color)}).addTo(personLayer)
            .bindPopup(`<b>${escapeHtml(p.person_id)} · 人员</b><br>${escapeHtml(view.label)}<br>${escapeHtml(view.level==='未知'?'仅为最后已知位置':r?.alert)}<br>采集 ${escapeHtml(localTime(p.timestamp))}`)
            .bindTooltip(escapeHtml(p.person_id));
    });
    $('zone-list').innerHTML=data.heatmap.map(z=>`<div class="zone-card" style="border-left-color:${colors[z.risk_level]}"><div class="card-top"><strong>${escapeHtml(z.zone_id)} ${escapeHtml(z.zone_type)}</strong><span class="risk-label">${escapeHtml(z.risk_level)}风险</span></div><div class="card-values"><span>有效人数 <b>${awaitingFreshCounts?'待核验':z.people_count}</b></span><span>规则评分 <b>${awaitingFreshCounts?'—':z.risk_score}</b></span></div><div class="card-meta">区域重叠时分别计数；全场人数按编号去重。</div></div>`).join('')||'<p class="empty">暂无区域</p>';
    counts();syncScene();
}
async function loadState(){
    if(window.FACTORY_WORKBENCH)return loadFactory();
    if(spatialBusy)return;spatialBusy=true;
    try{state.spatial=await request(`${API_BASE}/state`);status('gis-status',`空间已连接 · 版本 ${state.spatial.revision}`,true);}
    catch{state.spatial=null;status('gis-status','空间断连 · 人员状态未知',false);}
    finally{spatialBusy=false;renderSpatial();}
}
function renderDevices(){
    deviceLayer.clearLayers();
    if(!state.devices){$('device-list').textContent='无法获取设备数据，状态未知。';counts();syncScene();return;}
    const filter=$('device-filter').value;
    const cards=[];
    for(const d of state.devices){
        const view=deviceState(d);
        const description=`<b>${escapeHtml(d.device_id)} ${escapeHtml(d.device_type)}</b><br>${view.label}<br>${d.factory?escapeHtml(factoryReadings(d)):`负荷${d.load}% · 温度${d.temperature}℃ · 漏电${d.leakage}mA`}<br>采集 ${escapeHtml(localTime(d.timestamp))}`;
        L.marker([d.location[1],d.location[0]],{icon:icon('device',view.color)}).addTo(deviceLayer).bindPopup(description).bindTooltip(escapeHtml(d.device_id));
        if(filter!=='all' && filter!==view.level)continue;
        cards.push(`<div class="device-card" style="border-left-color:${view.color}"><div class="card-top"><strong>${escapeHtml(d.device_id)} ${escapeHtml(d.device_type)}</strong><span class="risk-label">${view.label}</span></div><div class="card-values">${d.factory?`<span>${escapeHtml(factoryReadings(d))}</span>`:`<span>${d.load}%</span><span>${d.temperature}℃</span><span>${d.leakage}mA</span>`}</div><div>${escapeHtml(view.level==='未知'?'观测过期，不能据此判断当前安全':d.alert)}</div><div class="card-meta">${d.source==='demo'?'演示观测':'上报观测'} · ${escapeHtml(localTime(d.timestamp))}</div><button type="button" class="locate" data-device="${escapeHtml(d.device_id)}">定位 ${escapeHtml(d.device_id)}</button></div>`);
    }
    $('device-list').innerHTML=cards.join('')||'<p class="empty">该分类暂无设备</p>';
    counts();syncScene();
}
function acceptDevices(data){
    state.devices=data.devices;state.snapshot=data.snapshot_id;
    $('snapshot-label').textContent=`观测 ${data.snapshot_id.slice(0,8)} · 2D / 3D 同源`;
    const selected=$('route-start').value;$('route-start').innerHTML=data.devices.map(d=>`<option value="${escapeHtml(d.device_id)}">${escapeHtml(d.device_id)}</option>`).join('');
    if(data.devices.some(d=>d.device_id===selected))$('route-start').value=selected;
    status('device-status','电气服务已连接',true);renderDevices();
}
async function loadDevices(){
    if(window.FACTORY_WORKBENCH)return loadFactory();
    if(deviceBusy)return;deviceBusy=true;
    try{acceptDevices(await request(`${ELECTRICAL_API}/devices`));}
    catch{state.devices=null;state.route=[];routeLayer.clearLayers();$('snapshot-label').textContent='';$('route-start').innerHTML='';status('device-status','电气断连 · 当前状态未知',false);renderDevices();}
    finally{deviceBusy=false;}
}
$('device-filter').addEventListener('change',renderDevices);
$('device-list').addEventListener('click',event=>{
    const button=event.target.closest('button[data-device]');if(!button)return;
    const d=state.devices?.find(d=>d.device_id===button.dataset.device);if(!d)return;
    if(state.mode==='3d')scene?.focus(...d.location);else map.setView([d.location[1],d.location[0]],19);
    showDetail({title:`${d.device_id} ${d.device_type}`,text:`${deviceState(d).label}。${d.factory?factoryReadings(d):`负荷${d.load}% / 温度${d.temperature}℃ / 漏电${d.leakage}mA`}。`});
});
$('simulate').addEventListener('click',async()=>{
    if(window.FACTORY_WORKBENCH){const {factoryRequest}=await import('./factory-client.mjs');await factoryRequest('/demo',{action:'start',key:'overview'});await loadFactory();notice('工厂人员移动演示已启动，首页与 GIS 同步。');return;}
    if(simulationBusy || deviceBusy || spatialBusy)return;simulationBusy=true;$('simulate').disabled=true;
    const results=await Promise.allSettled([request(`${ELECTRICAL_API}/simulation/tick`,{method:'POST'}),request(`${API_BASE}/simulation/tick`,{method:'POST'})]);
    if(results[0].status==='fulfilled')acceptDevices(results[0].value);
    if(results[1].status==='fulfilled'){state.spatial=results[1].value.state;renderSpatial();status('gis-status',`空间已连接 · 版本 ${state.spatial.revision}`,true);}
    const failures=results.map((r,i)=>r.status==='rejected'?`${i?'人员':'电气'}：${r.reason.message}`:null).filter(Boolean);
    notice(failures.length?failures.join('；'):'演示观测已更新；刷新只读数据，不会生成新观测。');
    simulationBusy=false;$('simulate').disabled=false;
});
$('refresh').addEventListener('click',async()=>{if(simulationBusy)return;$('refresh').disabled=true;await Promise.all([loadZones(),loadState(),loadDevices()]);$('refresh').disabled=false;});
const tabs=[...document.querySelectorAll('#panel-tabs .tab')];
function selectTab(tab){tabs.forEach(t=>{const active=t===tab;t.classList.toggle('active',active);t.setAttribute('aria-selected',active);t.tabIndex=active?0:-1;$(t.getAttribute('aria-controls')).classList.toggle('active',active);});}
tabs.forEach((tab,i)=>{tab.addEventListener('click',()=>selectTab(tab));tab.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();const next=tabs[(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length];selectTab(next);next.focus();}});});
document.querySelectorAll('[data-query]').forEach(button=>button.addEventListener('click',()=>{$('query').value=button.dataset.query;$('query').focus();}));
$('ask-form').addEventListener('submit',async event=>{
    event.preventDefault();$('ask-button').disabled=true;const query=$('query').value.trim();
    if(window.FACTORY_WORKBENCH&&!/巡检|路线/.test(query)){
        const data=state.factoryData;
        if(!data){$('answer').textContent='工厂后台断连，请恢复连接后查询当前观测。';}
        else{const people=data.entities.filter(e=>e.kind==='person'),devices=state.devices||[],actual=data.entities.filter(e=>e.positionSource==='telemetry'||e.measurementSource==='telemetry').length;
            $('answer').textContent=`工厂观测 v${data.revision} · ${localTime(data.updatedAt)}\n${people.length} 位人员、${devices.length} 台设备、${state.zones.features.length} 处危险区。\n当前 ${data.active.length} 条区域进入报警：${data.active.map(a=>`${a.entityId} → ${a.zoneId}${a.state==='unknown'?'（位置过期，待核验）':''}`).join('；')||'无'}。\n${actual} 个实体使用接口上报，其余为后台演示数据。\n${devices.slice(0,3).map(d=>`${d.device_id} ${d.device_type}：${factoryReadings(d)}`).join('\n')}\n设备安全阈值待现场配置，演示读数不能判定设备安全。`;
        }
        $('ask-button').disabled=false;return;
    }
    const options={method:'POST'};let points=null;
    if(/巡检|路线/.test(query)){
        state.route=[];routeLayer.clearLayers();syncScene();
        if(!state.devices || state.devices.length<2){$('answer').textContent='设备点位不足，请先恢复连接。';$('ask-button').disabled=false;return;}
        // Copy the exact request points; never redraw a response against a later refresh.
        points=state.devices.map(d=>({id:d.device_id,lng:d.location[0],lat:d.location[1],risk:d.risk_score}));
        options.headers={'Content-Type':'application/json'};options.body=JSON.stringify({start_id:$('route-start').value,points});
    }
    $('answer').textContent='正在读取数据并执行工具…';
    try{const data=await request(`${AGENT_API}/chat?query=${encodeURIComponent(query)}`,options);$('answer').textContent=data.answer;
        if(data.success && data.route_data && points){const byId=new Map(points.map(p=>[p.id,[p.lng,p.lat]]));state.route=data.route_data.route.map(id=>{if(!byId.has(id))throw new Error('路线包含未知点');return byId.get(id);});L.polyline(state.route.map(([lng,lat])=>[lat,lng]),{color:'#735cdb',dashArray:'6 6',weight:3}).addTo(routeLayer);syncScene();}
    }catch(error){$('answer').textContent=`未取得有效结果：${error.message}`;state.route=[];routeLayer.clearLayers();syncScene();}
    finally{$('ask-button').disabled=false;}
});
window.addEventListener('pagehide',event=>{if(!event.persisted)scene?.dispose();});
Promise.all([loadZones(),loadState(),loadDevices()]).then(()=>setMode('3d'));
setInterval(()=>{if(!simulationBusy){loadState();loadDevices();}},window.FACTORY_WORKBENCH?1000:30000);
setInterval(()=>{const key=JSON.stringify([state.devices?.map(d=>deviceState(d).level),state.spatial?.people.map(p=>window.SiteUI.fresh(p))]);if(key!==lastFreshness){lastFreshness=key;renderDevices();renderSpatial();if(state.spatial?.people.some(p=>p.fresh!==undefined && p.fresh!==window.SiteUI.fresh(p)))loadState();}},5000);

function factoryReadings(d){const names={temperature:'温度',load:'负荷',pressure:'压力',current:'电流',voltage:'电压',leakage:'漏电',speed:'速度'};return Object.entries(d.measurements||{}).map(([k,m])=>`${names[k]||k} ${m.value}${m.unit}`).join(' · ')||'测量数据待接入';}
async function loadFactory(){if(factoryBusy)return;factoryBusy=true;try{const [{factoryRequest},{adaptFactory}]=await Promise.all([import('./factory-client.mjs'),import('./factory-gis-data.mjs')]);const raw=await factoryRequest();const data=adaptFactory(raw);state.factoryData=raw;state.zones=data.zones;state.buffers=data.buffers;zoneLayer.clearLayers().addData(data.zones);bufferLayer.clearLayers();state.spatial=data.spatial;state.devices=data.devices;state.snapshot=data.snapshot_id;$('snapshot-label').textContent=`工厂观测 v${data.snapshot_id} · 首页 / GIS 同源`;status('gis-status',`工厂空间已连接 · 版本 ${data.snapshot_id}`,true);status('device-status','工厂监测已连接 · 自动同步',true);renderSpatial();renderDevices();if(!$('route-start').options.length)$('route-start').innerHTML=data.devices.map(d=>`<option value="${escapeHtml(d.device_id)}">${escapeHtml(d.device_id)}</option>`).join('');}catch(error){state.factoryData=null;state.spatial=null;state.devices=null;renderSpatial();renderDevices();status('gis-status','工厂后台断连 · 位置未知',false);status('device-status','监测断连 · 状态未知',false);}finally{factoryBusy=false;}}
