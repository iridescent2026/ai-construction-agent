const $=id=>document.getElementById(id);
const areaName=view=>({overview:'全景 · 室外施工',a:'A · 自动化装配',b:'B · 动力设备'}[view]);
let catalog=[],selected='',snapshot={active:[],events:[]},safetyKey='',activeDemoKey=null;
function cell(text){const td=document.createElement('td');td.textContent=text;return td;}
// Reuse live rows and controls so polling cannot remove a focused button.
const liveLists=new WeakMap();
function reconcile(container,items,key,create,update){
    let nodes=liveLists.get(container);if(!nodes){nodes=new Map();liveLists.set(container,nodes);}
    const active=new Set();
    items.forEach((item,index)=>{const id=key(item);active.add(id);let node=nodes.get(id);
        if(!node){node=create(item);nodes.set(id,node);}update(node,item);
        if(container.children[index]!==node)container.insertBefore(node,container.children[index]||null);
    });
    for(const [id,node] of nodes)if(!active.has(id)){node.remove();nodes.delete(id);}
}
function row(info,values,statusIndex=-1){
    const tr=document.createElement('tr');tr.dataset.entityId=info.id;
    tr.liveFields=values.map((value,index)=>{const td=cell(''),label=document.createElement(index===0?'strong':'span');td.appendChild(label);tr.appendChild(td);
        if(index===statusIndex)label.className='table-status';
        let reading=null;if(index===1&&info.kind==='device'){reading=document.createElement('small');reading.className='device-reading';td.appendChild(reading);}
        return {label,reading};
    });
    const action=cell(''),button=document.createElement('button');button.className='row-action';button.type='button';button.textContent='定位';
    button.addEventListener('click',()=>window.FactoryTwin?.locate(tr.liveInfo.id));action.appendChild(button);tr.appendChild(action);tr.liveButton=button;
    return tr;
}
function tableRows(container,items,values,statusIndex=-1,empty='暂无记录'){
    const entries=items.length?items:[{id:'__empty__',empty:true}];
    reconcile(container,entries,i=>i.id,i=>{if(!i.empty)return row(i,values(i),statusIndex);const tr=document.createElement('tr'),td=cell(empty);td.colSpan=values.columns;tr.appendChild(td);return tr;},(tr,info)=>{
        if(info.empty)return;tr.liveInfo=info;tr.classList.toggle('row-selected',selected===info.id);
        values(info).forEach((value,index)=>{const field=tr.liveFields[index];if(field.label.textContent!==value)field.label.textContent=value;
            if(index===statusIndex)field.label.className='table-status '+(info.riskState==='danger'?'danger':info.riskState==='clear'?'clear':'pending');
            if(field.reading){const reading=info.measurementLabel||'';if(field.reading.textContent!==reading)field.reading.textContent=reading;field.reading.hidden=!reading;}
        });
        tr.liveButton.setAttribute('aria-label',`定位 ${info.id} ${info.title}`);
    });
}
const searchText=value=>String(value).normalize('NFKC').toLowerCase().replace(/(?<![a-z0-9_])([abe])\s*[-‐‑‒–—−]?\s*(\d+)(?![a-z0-9_])/g,(_,prefix,digits)=>prefix+'-'+String(Number(digits)).padStart(2,'0'));
function render(){
    const devices=catalog.filter(i=>i.kind==='device'),people=catalog.filter(i=>i.kind==='person'),zones=catalog.filter(i=>i.kind==='zone');
    const query=searchText($('equipment-search').value.trim()),area=$('equipment-area').value,shown=devices.filter(i=>(area==='all'||i.view===area)&&searchText(`${i.id} ${i.title}`).includes(query));
    $('metric-devices').textContent=String(devices.length).padStart(2,'0');$('metric-people').textContent=String(people.length).padStart(2,'0');$('metric-zones').textContent=String(zones.length).padStart(2,'0');$('metric-alerts').textContent=String(snapshot.active.length).padStart(2,'0');$('rail-alert-count').textContent=String(snapshot.active.length);$('rail-alert-count').hidden=!snapshot.active.length;
    $('equipment-total').textContent=`${devices.length} 台登记 · ${shown.length} 台显示 · 后台自动同步`;$('personnel-total').textContent=`${people.length} 位编号人员`;$('zone-total').textContent=`${zones.length} 处危险区域`;
    const status=i=>i.riskState==='danger'?`进入 ${i.currentZones.join('、')}`:i.riskState==='unknown'?'位置未知':i.kind==='person'?'未进入限制区':i.mobile?(i.allowedZones?.length?'授权区域作业':'未进入限制区'):i.monitoring||'待接入';
    const deviceValues=i=>[i.id,i.title,areaName(i.view),status(i),i.measurementLabel||(i.text||'').replace(/^巡检关注：/,'').replace(' · 场景设计示意','')];deviceValues.columns=6;
    tableRows($('equipment-rows'),shown,deviceValues,3,'没有符合条件的设备');
    const personValues=i=>[i.id,i.role||i.title,areaName(i.view),status(i)];personValues.columns=5;
    tableRows($('personnel-rows'),people,personValues,3,'暂无人员记录');
    const zoneValues=i=>[i.id,i.title,areaName(i.view),`${snapshot.active.filter(a=>a.zoneId===i.id).length} 条进入报警${i.devices.length?' · '+i.devices.join('、'):''}`];zoneValues.columns=5;
    tableRows($('zone-rows'),zones,zoneValues,-1,'暂无危险区域');
    $('alarm-total').textContent=`${snapshot.active.length} 条${document.body?.classList.contains('replay-mode')?'历史':'当前'}报警 · ${snapshot.events.length} 条记录`;
    reconcile($('alarm-list'),snapshot.active.length?snapshot.active:[{id:'__empty__',empty:true}],a=>a.id||a.entityId+':'+a.zoneId,alarm=>{
        if(alarm.empty){const p=document.createElement('p');p.className='alarm-empty';p.textContent='当前没有区域进入报警。';return p;}
        const card=document.createElement('article');card.className='alarm-card';
        const icon=document.createElement('span');icon.className='alarm-icon';icon.textContent='!';const content=document.createElement('div'),title=document.createElement('strong'),description=document.createElement('p'),meta=document.createElement('small');content.appendChild(title);content.appendChild(description);content.appendChild(meta);
        const button=document.createElement('button');button.className='row-action';button.textContent='定位';button.addEventListener('click',()=>window.FactoryTwin?.locate(card.liveAlarm.entityId));card.appendChild(icon);card.appendChild(content);card.appendChild(button);card.liveParts={title,description,meta,button};return card;
    },(card,alarm)=>{if(alarm.empty)return;card.liveAlarm=alarm;const {title,description,meta,button}=card.liveParts;
        title.textContent=`${alarm.entityId} · ${alarm.title}`;description.textContent=`进入 ${alarm.zoneId} ${alarm.zoneTitle}`;meta.textContent=`${areaName(alarm.view)} · ${new Date(alarm.time).toLocaleTimeString('zh-CN',{hour12:false})} · ${alarm.source==='telemetry'?'接口定位':'演示定位'}`;button.setAttribute('aria-label',`查看报警 ${alarm.entityId} ${alarm.zoneId}`);
    });
    $('alarm-history').replaceChildren(...snapshot.events.map(event=>{const p=document.createElement('p');p.className='event-row '+event.type;p.textContent=`${new Date(event.time).toLocaleTimeString('zh-CN',{hour12:false})} · ${event.entityId} ${event.type==='enter'?'进入':'离开'} ${event.zoneId}`;return p;}));
}
function ready(){catalog=window.FactoryTwin.catalog();snapshot=window.FactoryTwin.safetySnapshot?.()||snapshot;render();}
$('equipment-search').addEventListener('input',render);$('equipment-area').addEventListener('change',render);
window.addEventListener('factory-ready',ready);
window.addEventListener('factory-select',e=>{selected=e.detail?.id||'';render();$('home-status').textContent=e.detail?`已定位 ${selected} · ${e.detail.title} · x=${e.detail.anchor?.[0]?.toFixed(1)} / z=${e.detail.anchor?.[2]?.toFixed(1)} m，位置与来源见场景详情。`:'';});
window.addEventListener('factory-safety-update',e=>{snapshot=e.detail;const key=JSON.stringify([snapshot.active.map(i=>[i.id,i.state]),catalog.filter(i=>i.kind==='person'||i.mobile).map(i=>i.riskState),snapshot.events[0]?.id]);if(key!==safetyKey){safetyKey=key;render();}});
window.addEventListener('factory-demo-change',e=>{activeDemoKey=e.detail.running?e.detail.key:null;$('demo-start').disabled=e.detail.running&&activeDemoKey===$('demo-source').value;$('demo-stop').disabled=!e.detail.running;$('demo-status').textContent=e.detail.running?`${e.detail.view==='overview'?'室外':'室内 '+e.detail.view.toUpperCase()+' 区'} · ${(e.detail.ids||[e.detail.id]).join(' / ')} 正在移动`:'后台每秒采样 · 页面自动同步';});
$('demo-start').addEventListener('click',()=>window.FactoryTwin?.startDemo($('demo-source').value));$('demo-stop').addEventListener('click',()=>window.FactoryTwin?.stopDemo());$('demo-reset').addEventListener('click',async()=>{const ok=await window.FactoryTwin?.resetDemo();if(ok)$('demo-status').textContent='已恢复所选路线的初始位置，其他路线保持不变';});
if(window.FactoryTwin)ready();

window.addEventListener('factory-data-update',e=>{catalog=window.FactoryTwin?.catalog()||catalog;const names={temperature:'温度',load:'负荷',pressure:'压力',current:'电流',voltage:'电压',leakage:'漏电',speed:'速度'};for(const info of catalog){if(info.kind==='device'){info.measurementLabel=Object.entries(info.measurements||{}).map(([k,m])=>`${names[k]||k} ${m.value}${m.unit}`).join(' · ');const clock=document.body?.classList.contains('replay-mode')?Date.parse(e.detail.updatedAt):Date.now(),age=clock-Date.parse(info.measurementTimestamp);info.monitoring=!Number.isFinite(age)||age < -5000||age>120000?'观测过期':info.measurementSource==='telemetry'?(info.measurementProvenance?.kind==='manual'?'手动测试导入':info.measurementProvenance?.kind==='authenticated_import'?'采集账号导入':'接口来源未核验'):'演示监测';}}render();});
window.addEventListener('factory-data-offline',()=>{for(const info of catalog)if(info.kind==='device')info.monitoring='后台断连';render();});

window.addEventListener('analysis-replay',e=>{const label=document.getElementById('metric-alerts')?.previousElementSibling;if(label)label.textContent=e.detail.data?'回放进入报警':'当前进入报警';});

$('demo-source').addEventListener('change',()=>{const key=$('demo-source').value;window.FactoryTwin?.switchView(['a','b'].includes(key)?key:'overview');$('demo-start').disabled=activeDemoKey===key;});
