import {observationSource, freshFactory} from './factory-client.mjs';

// Move live modules rather than clone them: handlers, draft inputs, roles and
// selected orders survive navigation. Both workbenches share this shell.
const home=document.body.classList.contains('factory-home'), $=id=>document.getElementById(id);
const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;};
document.body.classList.add('cast-console',home?'cast-home':'cast-gis');
document.body.dataset.industrialTheme='cast';
const panels=new Map(),scrollPositions=new Map();let active='',lastData,selectedId='';
const oldMain=document.querySelector('body>main'),header=document.querySelector('.app-header');
const rail=node('nav','cast-nav');rail.setAttribute('aria-label','工作台导航');
const workspace=node('main','cast-workspace'),stageColumn=node('section','cast-stage-column');
const inspector=node('aside','cast-inspector');inspector.setAttribute('aria-label','现场功能与对象详情');
const panelHead=node('div','cast-panel-head'),panelTitle=node('h2',null,'人员与设备');
const panelBody=node('div','cast-panel-body');panelBody.tabIndex=-1;
const close=node('button','cast-panel-close','收起');close.setAttribute('aria-label','收起右侧功能面板');
panelHead.append(node('span','cast-accent'),panelTitle,close);inspector.append(panelHead,panelBody);
workspace.append(stageColumn,inspector);header.after(rail,workspace);
const footer=node('div','cast-status');stageColumn.append(footer);
const addPanel=(key,title,element)=>{if(!element)return;element.classList.add('cast-content');panels.set(key,{title,element});element.hidden=true;panelBody.append(element);};
const existingAlert=$('rail-alert-count');existingAlert?.remove();
document.querySelector('.command-rail')?.remove();document.querySelector('.analysis-nav-left')?.remove();
// The top retains only global actions, never a second feature navigation.
if(home){const topNav=document.querySelector('.home-nav');topNav?.querySelectorAll('a').forEach(a=>a.remove());topNav?.setAttribute('aria-label','数据同步');}
else header.querySelector('a[href="./"]:not(.brand-lockup)')?.remove();
const gear=node('div','cast-turbine');gear.setAttribute('aria-hidden','true');
gear.innerHTML='<svg viewBox="0 0 100 100"><circle class="turbine-ring" cx="50" cy="50" r="43"/><circle cx="50" cy="50" r="32"/><g class="turbine-blades">'+Array.from({length:12},(_,i)=>`<path transform="rotate(${i*30} 50 50)" d="M47 14 55 14 59 39 52 44 47 35Z"/>`).join('')+'</g><circle class="turbine-hub" cx="50" cy="50" r="10"/></svg>';
header.querySelector('.account-toolbar')?.before(gear);
const account=header.querySelector('.account-toolbar');
if(account){const menu=node('details','cast-account-menu'),trigger=node('summary'),content=node('div','cast-account-options');trigger.setAttribute('aria-label','当前账号菜单');trigger.append($('account-avatar'),$('account-name'),node('span','cast-account-chevron','⌄'));content.append($('account-open'),$('account-switch'));menu.append(trigger,content);account.append(menu);document.addEventListener('click',e=>{if(!menu.contains(e.target))menu.open=false;});content.addEventListener('click',()=>menu.open=false);}

const wordmark=header.querySelector('.brand-title');if(wordmark){wordmark.setAttribute('aria-label',wordmark.textContent);const text=wordmark.textContent;wordmark.replaceChildren(...Array.from(text,(c,i)=>{const span=node('span',null,c);span.style.setProperty('--letter',i);return span;}));}
const icons={overview:'M3 10 12 3l9 7v10H3Z M9 20v-6h6v6',monitor:'M3 4h18v14H3Z M7 21h10 M12 18v3 M6 11h3l2-4 3 8 2-4h2',workflow:'M4 4h5v5H4Z M15 15h5v5h-5Z M17 4v5H9 M6 9v8h9',project:'M3 7h18v13H3Z M3 7V4h7l3 3 M7 12h10 M7 16h6'};
const groups=[
 ['overview','总览',[['overview','工厂空间'],['tasks','我的待办'],['other',home?'GIS 工作台 ↗':'A/B 工厂 ↗']]],
 ['monitor','现场监测',home?[['people','人员管理'],['devices','设备监测'],['zones','危险区域'],['alerts','报警中心']]:[['entities','人员与设备'],['zones','区域与告警'],['simulation','移动演示']]],
 ['workflow','协同处置',[['workflow','异常核查与助手'],['impact','设备影响链'],['plans','作业冲突'],['orders','维修闭环'],['replay','险情回放'],['energy','能耗与空转']]],
 ['project','项目管理',[['settings','图层与显示'],...(!home?[['ingest','观测接入'],['sources','来源与配准']]:[]),['feed','联动数据源'],['account','账号与工程审阅']]]
];
for(const [key,title,items] of groups){const group=node('details','cast-nav-group');group.dataset.group=key;group.open=false;const summary=node('summary');summary.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[key]}"/></svg><span>${title}</span><i aria-hidden="true">⌄</i>`;summary.setAttribute('aria-label',title);const sub=node('div','cast-nav-children');for(const [id,label] of items){const b=node('button','cast-nav-item',label);b.type='button';b.dataset.consolePanel=id;if(id==='alerts'&&existingAlert)b.append(existingAlert);sub.append(b);}summary.addEventListener('click',()=>document.body.classList.remove('cast-nav-collapsed'));group.append(summary,sub);rail.append(group);}
const railTools=node('div','cast-nav-tools'),collapse=node('button',null,'« 收起导航'),motion=node('button',null,'◉ 动效开启');collapse.setAttribute('aria-label','展开或收起侧栏');motion.setAttribute('aria-pressed','true');railTools.append(collapse,motion);rail.append(railTools);
collapse.onclick=()=>{const collapsed=document.body.classList.toggle('cast-nav-collapsed');collapse.textContent=collapsed?'»':'« 收起导航';};
try{if(localStorage.getItem('cast-motion')==='off')document.body.classList.add('cast-motion-off');}catch{}
function motionLabel(){const off=document.body.classList.contains('cast-motion-off');motion.textContent=off?'◉ 动效关闭':'◉ 动效开启';motion.setAttribute('aria-pressed',String(!off));}motionLabel();
motion.onclick=()=>{document.body.classList.toggle('cast-motion-off');motionLabel();try{localStorage.setItem('cast-motion',document.body.classList.contains('cast-motion-off')?'off':'on');}catch{}};

const localTools=node('div','cast-scene-tools'),sceneHost=node('div','cast-scene-host');
stageColumn.prepend(localTools);localTools.after(sceneHost);
let detail;
if(home){
 const metrics=document.querySelector('.home-metrics'),inventory=node('details','cast-inventory');inventory.append(node('summary',null,'工区台账概况'),metrics);$('dashboard-settings').prepend(inventory);
 const summary=node('div','cast-live-metrics');summary.innerHTML='<div><span class="cast-metric-icon">♟</span><div><span>有效位置</span><strong id="cast-valid">—</strong><small>位置来源见详情</small></div></div><div><span class="cast-metric-icon">?</span><div><span>位置未知</span><strong id="cast-unknown">—</strong><small>过期不视为安全</small></div></div><div><span class="cast-metric-icon">▤</span><div><span>待办工单</span><strong id="cast-orders">—</strong><small>当前登录岗位</small></div></div>';stageColumn.prepend(summary);
 const counts=()=>{const people=window.FactoryTwin?.catalog().filter(e=>e.kind==='person')||[];$('cast-valid').textContent=String(people.filter(e=>e.riskState!=='unknown').length).padStart(2,'0');$('cast-unknown').textContent=String(people.filter(e=>e.riskState==='unknown').length).padStart(2,'0');};window.addEventListener('factory-data-update',counts);window.addEventListener('factory-safety-update',counts);window.addEventListener('factory-ready',counts);counts();
 const taskGrid=$('my-task-grid');new MutationObserver(()=>{$('cast-orders').textContent=taskGrid.querySelector('b')?.textContent||'—';}).observe(taskGrid,{childList:true,subtree:true,characterData:true});$('cast-orders').textContent=taskGrid.querySelector('b')?.textContent||'—';

 localTools.append(document.querySelector('.view-tabs'));
 const restore=node('button',null,'返回上一镜头');restore.onclick=()=>window.FactoryTwin?.restoreCamera();localTools.append(restore);
 const quality=node('button',null,'精细材质');quality.setAttribute('aria-pressed','true');quality.onclick=()=>{const detailed=quality.getAttribute('aria-pressed')!=='true';quality.setAttribute('aria-pressed',String(detailed));quality.textContent=detailed?'精细材质':'轻量显示';window.FactoryTwin?.setVisualQuality(detailed);};localTools.append(quality);
 const scene=document.querySelector('.scene-card');sceneHost.append(scene);detail=$('factory-detail');detail.classList.add('cast-object-detail');inspector.append(detail);
 addPanel('overview','园区与工区',document.querySelector('.inspection-panel'));
 for(const [key,id,title] of [['people','personnel-management','人员管理'],['devices','equipment-management','设备监测'],['zones','zone-management','危险区域'],['alerts','alarm-management','报警中心'],['settings','dashboard-settings','图层与显示']])addPanel(key,title,$(id));
 footer.append($('live-strip'),$('home-status'));
 // Retain the original layout adjustment controls, now applied to this split.
 $('drawer-width')?.addEventListener('input',e=>{workspace.style.setProperty('--inspector',e.target.value+'px');$('drawer-width-value').textContent=e.target.value+' px';});
 $('scene-height')?.addEventListener('input',e=>{sceneHost.style.setProperty('--preferred-scene-height',e.target.value+'px');$('scene-height-value').textContent=e.target.value+' px';});
 document.querySelectorAll('[data-factory-layer]').forEach(input=>input.addEventListener('change',()=>window.FactoryTwin?.setLayer(input.dataset.factoryLayer,input.checked)));
 window.addEventListener('factory-layer-change',e=>{const input=document.querySelector(`[data-factory-layer="${e.detail.kind}"]`);if(input)input.checked=e.detail.enabled;});
}else{
 stageColumn.prepend(document.querySelector('.metric-row'));localTools.append(document.querySelector('.view-buttons'));
 const sidebar=document.querySelector('.gis-layout>.sidebar'),main=document.querySelector('.gis-layout>.main'),scene=main.querySelector('section.metal');
 sceneHost.append(scene);detail=$('reference-detail');detail.classList.add('cast-object-detail');inspector.append(detail);
 const refresh=$('refresh-observations');header.querySelector('.account-toolbar')?.before(refresh);refresh.textContent='刷新数据';header.append($('refresh-observations-result'));
 const demo=document.querySelector('.demo-settings'),simulation=node('section'),zones=node('section');
 const h=Array.from(demo.children).find(e=>e.tagName==='H2'&&e.textContent==='地图区域索引');
 while(demo.firstChild&&demo.firstChild!==h)simulation.append(demo.firstChild);
 const ingest=demo.querySelector('.data-connect');ingest.remove();ingest.open=true;
 while(demo.firstChild)zones.append(demo.firstChild);
 demo.remove();addPanel('simulation','室外移动演示',simulation);addPanel('zones','区域与告警',zones);addPanel('ingest','观测接入与核验',ingest);
 const source=document.querySelector('.source-box');addPanel('sources','来源与对应关系',source);addPanel('settings','图层与空间依据',sidebar);
 const sourceTitle=$('site-name');if(sourceTitle){const hint=node('span','cast-project-name');hint.textContent=sourceTitle.textContent;header.querySelector('.brand-lockup')?.after(hint);new MutationObserver(()=>hint.textContent=sourceTitle.textContent).observe(sourceTitle,{childList:true,subtree:true,characterData:true});}
 const directory=node('section','cast-live-directory');directory.innerHTML='<div class="cast-directory-tools"><input id="cast-object-search" type="search" aria-label="搜索室外人员与设备" placeholder="搜索编号、岗位或设备"><select id="cast-object-kind" aria-label="室外对象类型"><option value="person">人员</option><option value="device">设备</option></select></div><p class="cast-note">模拟与导入来源单独标明；灰色为位置未知。</p><div id="cast-live-rows"></div>';
 addPanel('entities','人员与设备',directory);addPanel('overview','室外人员与设备',node('section'));
 footer.append(scene.querySelector('.status-bar'));
 const records=new Map();
 function renderDirectory(){if(!lastData)return;const search=$('cast-object-search').value.trim().toLowerCase(),kind=$('cast-object-kind').value;const rows=lastData.entities.filter(e=>e.view==='overview'&&e.kind===kind&&`${e.id} ${e.title} ${e.role||''}`.toLowerCase().includes(search)),seen=new Set();
  for(const e of rows){seen.add(e.id);let record=records.get(e.id);if(!record){const card=node('article','cast-live-row'),glyph=node('span','cast-worker-icon',e.kind==='person'?'◉':'▣'),copy=node('div'),title=node('strong'),description=node('small'),position=node('small'),button=node('button',null,'定位');button.setAttribute('aria-label','定位 '+e.id);copy.append(title,description,position);card.append(glyph,copy,button);button.onclick=()=>window.GisWorkbench?.locate(e.id);record={card,title,description,position};records.set(e.id,record);$('cast-live-rows').append(card);}record.card.classList.toggle('selected',selectedId===e.id);record.card.classList.toggle('unknown',!freshFactory(e.positionTimestamp,lastData.updatedAt));record.title.textContent=e.id+' · '+(e.role||e.title);record.description.textContent=observationSource(e,'position');record.position.textContent=(e.riskState==='unknown'?'最后已知位置 · ':e.riskState==='danger'?'进入 '+e.currentZones.join('、')+' · ':'未进入限制区 · ')+(e.positionTimestamp?new Date(e.positionTimestamp).toLocaleTimeString('zh-CN',{hour12:false}):'未接入');}
  for(const [id,r] of records)if(!seen.has(id)){r.card.remove();records.delete(id);}
  let empty=$('cast-empty');if(!rows.length&&!empty){empty=node('p','cast-note','没有匹配对象');empty.id='cast-empty';$('cast-live-rows').append(empty);}else if(rows.length)empty?.remove();
 }
 $('cast-object-search').oninput=renderDirectory;$('cast-object-kind').onchange=renderDirectory;
 window.addEventListener('factory-data-update',e=>{lastData=e.detail;renderDirectory();});window.addEventListener('gis-select',e=>{selectedId=e.detail?.id||'';renderDirectory();});
 window.addEventListener('analysis-replay',e=>{lastData=e.detail.data||window.GisWorkbench?.snapshot();renderDirectory();});
 for(const id of ['panel-width','stage-height'])$(id)?.addEventListener('input',e=>{if(id==='panel-width')workspace.style.setProperty('--inspector',e.target.value+'px');else sceneHost.style.setProperty('--preferred-scene-height',e.target.value+'px');});
}
addPanel('tasks','我的待办',$('my-tasks'));
const analysis=$('factory-analysis');addPanel('analysis','工厂分析与作业闭环',analysis);
// All analysis tabs, engineering evidence, experiments and model chat remain
// inside their original host so existing host-scoped selectors stay valid.
if(!existingAlert){const badge=node('b');badge.id='rail-alert-count';badge.hidden=true;rail.querySelector('[data-console-panel="zones"]')?.append(badge);}
oldMain.hidden=true;
const hint=node('span','cast-context-note','局部定位 · 保留列表位置');footer.append(hint);
function show(key,{analysisTab,focus=false}={}){
 if(key==='other'){location.href=home?'workbench.html':'./';return;}
 if(key==='account'){$('account-open')?.click();return;}
 if(!home&&key==='overview')key='entities';
 const tab=['impact','plans','orders','replay','energy'].includes(key)?key:analysisTab;
 const panelKey=key==='workflow'||key==='feed'||tab?'analysis':key, record=panels.get(panelKey);if(!record)return;
 if(active)scrollPositions.set(active,panelBody.scrollTop);
 for(const [id,panel] of panels)panel.element.hidden=id!==panelKey;
 active=key;panelTitle.textContent=key==='workflow'?'设备异常处置':key==='feed'?'五项联动数据源':record.title;
 workspace.dataset.panel=key;workspace.classList.remove('inspector-hidden');
 document.body.classList.toggle('cast-analysis-active',panelKey==='analysis');
 if(analysis){analysis.dataset.consoleMode=key==='workflow'?'workflow':key==='feed'?'feed':'analysis';}
 rail.querySelectorAll('[data-console-panel]').forEach(b=>{b.classList.toggle('active',b.dataset.consolePanel===key);if(b.dataset.consolePanel===key)b.closest('details').open=true;});
 panelBody.scrollTop=scrollPositions.get(key)||0;
 if(tab){window.dispatchEvent(new CustomEvent('cast-analysis-select',{detail:{tab}}));}
 if(focus)panelBody.focus({preventScroll:true});
}
rail.addEventListener('toggle',e=>{if(e.target.matches('.cast-nav-group')&&e.target.open)for(const g of rail.querySelectorAll('.cast-nav-group'))if(g!==e.target)g.open=false;},true);
rail.addEventListener('click',e=>{const b=e.target.closest('[data-console-panel]');if(b)show(b.dataset.consolePanel,{focus:true});});
close.onclick=()=>workspace.classList.toggle('inspector-hidden');
const reveal=node('button','cast-reveal','列表 ›');reveal.onclick=()=>workspace.classList.remove('inspector-hidden');sceneHost.append(reveal);
window.addEventListener('analysis-navigate',e=>show(e.detail.tab));
window.addEventListener('workflow-order-created',()=>show('orders'));
window.addEventListener('cast-panel-open',e=>show(e.detail.key));
window.addEventListener('factory-select',e=>{selectedId=e.detail?.id||'';hint.textContent=selectedId?'已定位 '+selectedId+' · 筛选与列表位置保留':'局部定位 · 保留列表位置';});
window.addEventListener('gis-select',e=>hint.textContent=e.detail?.id?'已定位 '+e.detail.id+' · 列表位置保留':'局部定位 · 保留列表位置');
window.addEventListener('analysis-tab-change',e=>rail.querySelectorAll('[data-console-panel]').forEach(b=>{if(['impact','plans','orders','replay','energy'].includes(b.dataset.consolePanel))b.classList.toggle('active',workspace.dataset.panel!=='workflow'&&b.dataset.consolePanel===e.detail.tab);}));
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.querySelector('dialog[open]'))workspace.classList.remove('inspector-hidden');});
window.CastConsole={show,panels:()=>Array.from(panels.keys()),active:()=>workspace.dataset.panel};
show(home?'overview':'entities');
