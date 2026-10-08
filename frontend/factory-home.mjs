const $=id=>document.getElementById(id);
const areaName=view=>({overview:'全景 · 室外施工',a:'A · 自动化装配',b:'B · 动力设备'}[view]);
let catalog=[],selected='',snapshot={active:[],events:[]},safetyKey='';
function cell(text){const td=document.createElement('td');td.textContent=text;return td;}
function row(info,values,statusIndex=-1){
    const tr=document.createElement('tr');tr.dataset.entityId=info.id;tr.classList.toggle('row-selected',selected===info.id);
    values.forEach((value,index)=>{const td=cell(value);if(index===0){const strong=document.createElement('strong');strong.textContent=value;td.replaceChildren(strong);}if(index===statusIndex){const badge=document.createElement('span');badge.className='table-status '+(info.riskState==='danger'?'danger':info.riskState==='clear'?'clear':'pending');badge.textContent=value;td.replaceChildren(badge);}if(index===1&&info.kind==='device'&&info.measurementLabel){const reading=document.createElement('small');reading.className='device-reading';reading.textContent=info.measurementLabel;td.appendChild(reading);}tr.appendChild(td);});
    const action=cell(''),button=document.createElement('button');button.className='row-action';button.type='button';button.textContent='定位';button.setAttribute('aria-label',`定位 ${info.id} ${info.title}`);button.addEventListener('click',()=>window.FactoryTwin?.locate(info.id));action.appendChild(button);tr.appendChild(action);return tr;
}
function render(){
    const devices=catalog.filter(i=>i.kind==='device'),people=catalog.filter(i=>i.kind==='person'),zones=catalog.filter(i=>i.kind==='zone');
    const query=$('equipment-search').value.trim().toLowerCase(),area=$('equipment-area').value,shown=devices.filter(i=>(area==='all'||i.view===area)&&`${i.id} ${i.title}`.toLowerCase().includes(query));
    $('metric-devices').textContent=String(devices.length).padStart(2,'0');$('metric-people').textContent=String(people.length).padStart(2,'0');$('metric-zones').textContent=String(zones.length).padStart(2,'0');$('metric-alerts').textContent=String(snapshot.active.length).padStart(2,'0');$('rail-alert-count').textContent=String(snapshot.active.length);$('rail-alert-count').hidden=!snapshot.active.length;
    $('equipment-total').textContent=`${devices.length} 台登记 · ${shown.length} 台显示 · 后台自动同步`;$('personnel-total').textContent=`${people.length} 位编号人员`;$('zone-total').textContent=`${zones.length} 处危险区域`;
    const status=i=>i.riskState==='danger'?`进入 ${i.currentZones.join('、')}`:i.riskState==='unknown'?'位置未知':i.kind==='person'?'未进入限制区':i.mobile?(i.allowedZones?.length?'授权区域作业':'未进入限制区'):i.monitoring||'待接入';
    $('equipment-rows').replaceChildren(...shown.map(i=>row(i,[i.id,i.title,areaName(i.view),status(i),i.measurementLabel||i.text.replace(/^巡检关注：/,'').replace(' · 场景设计示意','')],3)));
    if(!shown.length){const tr=document.createElement('tr'),td=cell('没有符合条件的设备');td.colSpan=6;tr.appendChild(td);$('equipment-rows').appendChild(tr);}
    $('personnel-rows').replaceChildren(...people.map(i=>row(i,[i.id,i.role||i.title,areaName(i.view),status(i)],3)));
    $('zone-rows').replaceChildren(...zones.map(i=>row(i,[i.id,i.title,areaName(i.view),`${snapshot.active.filter(a=>a.zoneId===i.id).length} 条进入报警${i.devices.length?' · '+i.devices.join('、'):''}`])));
    $('alarm-total').textContent=`${snapshot.active.length} 条${document.body?.classList.contains('replay-mode')?'历史':'当前'}报警 · ${snapshot.events.length} 条记录`;
    $('alarm-list').replaceChildren(...snapshot.active.map(alarm=>{
        const card=document.createElement('article');card.className='alarm-card';
        const icon=document.createElement('span');icon.className='alarm-icon';icon.textContent='!';const content=document.createElement('div'),title=document.createElement('strong'),description=document.createElement('p');title.textContent=`${alarm.entityId} · ${alarm.title}`;description.textContent=`进入 ${alarm.zoneId} ${alarm.zoneTitle}`;const meta=document.createElement('small');meta.textContent=`${areaName(alarm.view)} · ${new Date(alarm.time).toLocaleTimeString('zh-CN',{hour12:false})} · ${alarm.source==='telemetry'?'接口定位':'演示定位'}`;content.appendChild(title);content.appendChild(description);content.appendChild(meta);
        const button=document.createElement('button');button.className='row-action';button.textContent='定位';button.setAttribute('aria-label',`查看报警 ${alarm.entityId} ${alarm.zoneId}`);button.addEventListener('click',()=>window.FactoryTwin.locate(alarm.entityId));card.appendChild(icon);card.appendChild(content);card.appendChild(button);return card;
    }));
    if(!snapshot.active.length){const p=document.createElement('p');p.className='alarm-empty';p.textContent='当前没有区域进入报警。';$('alarm-list').appendChild(p);}
    $('alarm-history').replaceChildren(...snapshot.events.map(event=>{const p=document.createElement('p');p.className='event-row '+event.type;p.textContent=`${new Date(event.time).toLocaleTimeString('zh-CN',{hour12:false})} · ${event.entityId} ${event.type==='enter'?'进入':'离开'} ${event.zoneId}`;return p;}));
}
function ready(){catalog=window.FactoryTwin.catalog();snapshot=window.FactoryTwin.safetySnapshot?.()||snapshot;render();}
$('equipment-search').addEventListener('input',render);$('equipment-area').addEventListener('change',render);
window.addEventListener('factory-ready',ready);
window.addEventListener('factory-select',e=>{selected=e.detail?.id||'';render();$('home-status').textContent=e.detail?`已定位 ${selected} · ${e.detail.title} · x=${e.detail.anchor?.[0]?.toFixed(1)} / z=${e.detail.anchor?.[2]?.toFixed(1)} m，位置与来源见场景详情。`:'';});
window.addEventListener('factory-safety-update',e=>{snapshot=e.detail;const key=JSON.stringify([snapshot.active.map(i=>[i.id,i.state]),catalog.filter(i=>i.kind==='person'||i.mobile).map(i=>i.riskState),snapshot.events[0]?.id]);if(key!==safetyKey){safetyKey=key;render();}});
window.addEventListener('factory-demo-change',e=>{$('demo-start').disabled=e.detail.running;$('demo-stop').disabled=!e.detail.running;$('demo-status').textContent=e.detail.running?`${e.detail.id} 正在移动 · 区域进入判断运行中`:'后台每秒采样 · 页面自动同步';});
$('demo-start').addEventListener('click',()=>window.FactoryTwin?.startDemo($('demo-source').value));$('demo-stop').addEventListener('click',()=>window.FactoryTwin?.stopDemo());$('demo-reset').addEventListener('click',()=>{window.FactoryTwin?.resetDemo();$('demo-status').textContent='已恢复初始模拟位置';});
if(window.FactoryTwin)ready();

window.addEventListener('factory-data-update',e=>{const names={temperature:'温度',load:'负荷',pressure:'压力',current:'电流',voltage:'电压',leakage:'漏电',speed:'速度'};for(const info of catalog){if(info.kind==='device'){info.measurementLabel=Object.entries(info.measurements||{}).map(([k,m])=>`${names[k]||k} ${m.value}${m.unit}`).join(' · ');const clock=document.body?.classList.contains('replay-mode')?Date.parse(e.detail.updatedAt):Date.now(),age=clock-Date.parse(info.measurementTimestamp);info.monitoring=!Number.isFinite(age)||age < -5000||age>120000?'观测过期':info.measurementSource==='telemetry'?'接口上报':'演示监测';}}render();});
window.addEventListener('factory-data-offline',()=>{for(const info of catalog)if(info.kind==='device')info.monitoring='后台断连';render();});

window.addEventListener('analysis-replay',e=>{const label=document.getElementById('metric-alerts')?.previousElementSibling;if(label)label.textContent=e.detail.data?'回放进入报警':'当前进入报警';});
