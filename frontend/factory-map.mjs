import {geoPoint,adaptFactory} from './factory-gis-data.mjs';
import {factoryBase,measurementText,freshFactory} from './factory-client.mjs';

const $=id=>document.getElementById(id),L=window.L;
let map,base,siteLayer,demoLayer,zoneLayer,measureLine,routeLine,site,lastData,mapVisible=false,demoVisible=false,measuring=false,measurePoints=[],records=new Map(),metadata,switchedMirror=false,loaded=0,failed=0,positionAttached=false;
const initialMap=new URLSearchParams(location.search).get('view')==='map';
const names={overview:'室外施工示意',a:'A 区示意',b:'B 区示意'};
const stage=$('satellite-stage'),controls=$('satellite-controls'),sourceBar=$('map-source-bar');
function setStatus(text,error=false){$('map-load-status').textContent=text;$('map-load-status').classList.toggle('offline',error);}
function popup(info){
    const box=document.createElement('div'),title=document.createElement('strong'),p=document.createElement('p');title.textContent=`${info.id} · ${info.title}`;
    const risk=info.riskState==='danger'?`进入 ${info.currentZones.join('、')}`:info.riskState==='unknown'?'定位未知':info.kind==='person'||info.mobile?'未进入限制区':'';
    p.textContent=`${names[info.view]} · ${risk}。${info.kind==='device'?measurementText(info):info.positionSource==='telemetry'?'接口定位':'演示定位'}。`;
    const note=document.createElement('small');note.textContent='示意点位，未与真实厂房配准。';box.append(title,p,note);return box;
}
function markerIcon(info){const color=info.riskState==='unknown'?'#98a1ac':info.riskState==='danger'?'#ff6868':info.kind==='person'?'#73cdb0':info.kind==='zone'?'#e89068':'#e0b354';return L.divIcon({className:'map-pin '+info.kind,html:`<span style="--pin:${color}"></span>`,iconSize:[18,18],iconAnchor:[4,4]});}
function currentInfo(id){return lastData?.entities.find(e=>e.id===id);}
function updateMarkers(){
    if(!map||!lastData)return;
    const enabled={person:$('map-demo-points').checked&&document.querySelector('[data-factory-layer="person"]').checked,device:$('map-demo-points').checked&&document.querySelector('[data-factory-layer="device"]').checked,zone:$('map-demo-points').checked&&document.querySelector('[data-factory-layer="zone"]').checked};
    const seen=new Set();
    for(const info of lastData.entities){
        if(!enabled[info.kind])continue;seen.add(info.id);const point=geoPoint(lastData,info.view,info.anchor[0],info.anchor[2]);let record=records.get(info.id);
        if(!record){
            const marker=L.marker([point[1],point[0]],{icon:markerIcon(info),keyboard:true,title:`查看 ${info.id} ${info.title}`}).addTo(demoLayer);
            marker.bindTooltip(`${info.id} · ${info.title}`,{direction:'top'}).bindPopup(popup(info));
            marker.on('click',()=>{if(!measuring){const latest=currentInfo(info.id);window.dispatchEvent(new CustomEvent('factory-select',{detail:latest}));}});
            record={marker,info};records.set(info.id,record);
        }
        record.info=info;record.marker.setLatLng([point[1],point[0]]).setIcon(markerIcon(info));if(record.marker.isPopupOpen())record.marker.setPopupContent(popup(info));
    }
    for(const [id,record] of records)if(!seen.has(id)){demoLayer.removeLayer(record.marker);records.delete(id);}
    zoneLayer.clearLayers();
    if(enabled.zone){const collection=adaptFactory(lastData).zones;L.geoJSON(collection,{style:f=>({color:'#ed936d',weight:1.2,fillOpacity:lastData.active.some(a=>a.zoneId===f.properties.zone_id)?.18:.06,dashArray:'5 4'}),onEachFeature:(f,layer)=>layer.bindTooltip(`${f.properties.zone_id} · ${f.properties.zone_type}（示意）`)}).addTo(zoneLayer);}
}
function allSite(){if(!map||!site)return;const [west,south,east,north]=site.bounds;map.fitBounds([[south,west],[north,east]],{padding:[45,45],maxZoom:17});}
function demoArea(){if(!map||!lastData)return;$('map-demo-points').checked=true;demoVisible=true;updateMarkers();const origin=lastData.coordinateSystem.origin;map.setView([origin[1],origin[0]],18);}
function sourceText(){if(!site)return;const m=metadata||site.imagery.metadata;$('map-imagery-meta').textContent=`Esri / ${m.provider||'World Imagery'} · 采集 ${m.acquired||'日期未标注'}${m.sourceResolution?' · 源分辨率 '+m.sourceResolution+' m':''}${m.status==='reference'?' · 参考记录':''}`;$('map-imagery-link').href=m.sourceUrl;}
async function loadMetadata(refresh=false){try{const response=await fetch(`${factoryBase}/factory/imagery-metadata${refresh?'?refresh=true':''}`,{signal:AbortSignal.timeout(6500),cache:'no-store'});if(!response.ok)throw new Error();metadata=await response.json();sourceText();}catch{if(site){metadata={...site.imagery.metadata,status:'reference'};sourceText();}}}
async function init(){
    if(map)return;
    if(!L)throw new Error('地图组件未载入');
    site=lastData?.site||await fetch('assets/factory/demo-site.json').then(r=>{if(!r.ok)throw new Error('厂区信息不可用');return r.json();});
    map=L.map('satellite-map',{zoomControl:false,minZoom:3,maxZoom:20,preferCanvas:true}).setView([site.center[1],site.center[0]],16);
    L.control.zoom({position:'topright'}).addTo(map);L.control.scale({imperial:false,position:'bottomleft'}).addTo(map);
    base=L.tileLayer(site.imagery.url,{maxNativeZoom:site.imagery.maxNativeZoom,maxZoom:20,minZoom:3,attribution:'Imagery © Esri, Vantor, Earthstar Geographics, GIS User Community',keepBuffer:2});
    base.on('loading',()=>{loaded=0;failed=0;setStatus('正在载入官方卫星影像…');});
    base.on('tileload',()=>{loaded++;setStatus(`真实卫星影像已载入${failed?' · 部分瓦片不可用':''}`);});
    base.on('tileerror',()=>{failed++;if(!switchedMirror){switchedMirror=true;setStatus('影像节点暂不可达，切换官方备用节点…');base.setUrl(site.imagery.fallbackUrl);}else setStatus(loaded?'影像部分载入 · 可点击重载':'卫星影像不可达 · 点击重载影像',true);});
    base.addTo(map);demoLayer=L.layerGroup().addTo(map);zoneLayer=L.layerGroup().addTo(map);
    const response=await fetch('assets/factory/demo-site.geojson');if(response.ok){const geometry=await response.json();siteLayer=L.geoJSON(geometry,{style:{color:'#e5c37f',weight:1.5,fillOpacity:0,dashArray:'8 5'},attribution:'厂区轮廓 © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors, ODbL'}).addTo(map);siteLayer.bindTooltip(site.name+' · 公开厂区轮廓');}
    $('map-site-name').textContent=site.name;$('map-site-note').textContent='真实卫星影像 · 公开厂区轮廓';$('map-site-link').href=site.sources.find(s=>s.title.includes('OpenStreetMap')).url;
    sourceText();loadMetadata();allSite();updateMarkers();
    map.on('mousemove',event=>{$('map-position').textContent=`WGS84 ${event.latlng.lng.toFixed(6)} E / ${event.latlng.lat.toFixed(6)} N${measuring?' · 点击地图测距':''}`;});
    map.on('click',event=>{if(!measuring)return;measurePoints.push(event.latlng);if(measureLine)measureLine.setLatLngs(measurePoints);else measureLine=L.polyline(measurePoints,{color:'#f4d786',weight:2,dashArray:'4 5'}).addTo(map);let distance=0;for(let i=1;i<measurePoints.length;i++)distance+=map.distance(measurePoints[i-1],measurePoints[i]);$('map-position').textContent=`累计直线测距 ${distance.toFixed(1)} m · ${measurePoints.length} 个节点`;});
}
async function showMap(){
    mapVisible=true;stage.hidden=false;controls.hidden=false;sourceBar.hidden=false;$('factory-stage').hidden=true;$('factory-reset').hidden=true;$('factory-export').hidden=true;document.querySelector('.simulation-controls').hidden=true;
    $('scene-title').textContent='卫星地图 · 工厂地理底座';$('view-code').textContent='GIS / SATELLITE';
    document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed','false'));document.querySelectorAll('[data-map-view]').forEach(b=>{b.classList.add('map-selected');b.setAttribute('aria-pressed','true');});
    window.FactoryTwin?.setRendererVisible(false);
    try{await init();map.invalidateSize();}catch(error){setStatus(error.message,true);}
}
function leaveMap(){if(!mapVisible)return;mapVisible=false;stage.hidden=true;controls.hidden=true;sourceBar.hidden=true;$('factory-stage').hidden=false;$('factory-reset').hidden=false;$('factory-export').hidden=false;document.querySelector('.simulation-controls').hidden=false;document.querySelectorAll('[data-map-view]').forEach(b=>{b.classList.remove('map-selected');b.setAttribute('aria-pressed','false');});window.FactoryTwin?.setRendererVisible(true);}
document.querySelectorAll('[data-map-view]').forEach(button=>button.addEventListener('click',event=>{event.preventDefault();showMap();}));
window.addEventListener('factory-view-change',()=>{if(window.FactoryTwin)leaveMap();});
window.addEventListener('factory-data-update',event=>{lastData=event.detail;updateMarkers();});
window.addEventListener('factory-data-offline',()=>{if(lastData){for(const info of lastData.entities)if(info.kind==='person'||info.mobile)info.riskState='unknown';updateMarkers();}});
window.addEventListener('factory-ready',()=>{
    const locate=window.FactoryTwin.locate.bind(window.FactoryTwin);
    window.FactoryTwin.locate=id=>{if(!mapVisible)return locate(id);const info=currentInfo(id);if(!info)return false;demoArea();const point=geoPoint(lastData,info.view,info.anchor[0],info.anchor[2]);map.setView([point[1],point[0]],19);records.get(id)?.marker.openPopup();window.dispatchEvent(new CustomEvent('factory-select',{detail:info}));return true;};
    if(mapVisible)window.FactoryTwin.setRendererVisible(false);
});
document.querySelectorAll('[data-factory-layer]').forEach(input=>input.addEventListener('change',updateMarkers));
$('map-full-site').addEventListener('click',allSite);$('map-demo-area').addEventListener('click',demoArea);$('map-demo-points').addEventListener('change',()=>{demoVisible=$('map-demo-points').checked;updateMarkers();});
$('map-reload').addEventListener('click',()=>{if(!base)return;switchedMirror=false;loaded=0;failed=0;setStatus('正在重新请求当前影像…');base.setUrl(site.imagery.url);base.redraw();loadMetadata(true);});
$('map-measure').addEventListener('click',()=>{measuring=!measuring;$('map-measure').setAttribute('aria-pressed',String(measuring));$('map-position').textContent=measuring?'点击地图节点进行直线测距':'已退出测距';});
$('map-clear').addEventListener('click',()=>{measurePoints=[];if(measureLine){map.removeLayer(measureLine);measureLine=null;}if(routeLine){map.removeLayer(routeLine);routeLine=null;}window.FactoryTwin?.setRoute([],lastData?.coordinateSystem.origin);$('map-position').textContent='测距及巡检连线已清除';});
$('map-plan-route').addEventListener('click',async()=>{
    if(!lastData||!freshFactory(lastData.updatedAt)){$('map-position').textContent='观测过期，恢复连接后再规划。';return;}
    const points=adaptFactory(lastData).devices.map(d=>({id:d.device_id,lng:d.location[0],lat:d.location[1],risk:d.risk_score}));const start=points.find(p=>p.id===$('map-route-start').value)?.id||points[0]?.id;if(points.length<2)return;
    $('map-plan-route').disabled=true;$('map-position').textContent='正在规划同一观测下的巡检顺序…';
    try{const response=await fetch(`${window.APP_CONFIG?.agent||'http://127.0.0.1:8002'}/chat?query=${encodeURIComponent('规划巡检路线')}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({start_id:start,points}),signal:AbortSignal.timeout(12000)});if(!response.ok)throw new Error('巡检服务不可达');const data=await response.json();if(!data.success||!Array.isArray(data.route_data?.route))throw new Error('未取得有效巡检顺序');const byId=new Map(points.map(p=>[p.id,[p.lng,p.lat]]));const route=data.route_data.route.map(id=>{if(!byId.has(id))throw new Error('巡检结果包含未知编号');return byId.get(id);});if(routeLine)map.removeLayer(routeLine);routeLine=L.polyline(route.map(([lng,lat])=>[lat,lng]),{color:'#cdb1fb',weight:2,dashArray:'6 5'}).addTo(map);demoArea();window.FactoryTwin?.setRoute(route,lastData.coordinateSystem.origin);$('map-position').textContent=`已规划 ${route.length} 个示意设备 · 连线仅表示顺序`;}
    catch(error){$('map-position').textContent=error.message;}finally{$('map-plan-route').disabled=false;}
});
window.addEventListener('factory-data-update',()=>{if(!positionAttached&&lastData){positionAttached=true;const devices=lastData.entities.filter(e=>e.kind==='device');$('map-route-start').replaceChildren(...devices.map(d=>{const option=document.createElement('option');option.value=d.id;option.textContent=d.id;return option;}));}});
new ResizeObserver(()=>{if(mapVisible)map?.invalidateSize();}).observe(stage);
window.FactoryMap={isVisible:()=>mapVisible,show:showMap};
window.addEventListener('pagehide',event=>{if(!event.persisted)map?.remove();});
if(initialMap)showMap();
