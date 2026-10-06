const $=id=>document.getElementById(id),drawer=$('dashboard-drawer'),content=$('drawer-content');
const sections={devices:$('equipment-management'),people:$('personnel-management'),zones:$('zone-management'),alerts:$('alarm-management'),settings:$('dashboard-settings')};
const titles={devices:'设备监测',people:'人员管理',zones:'危险区域',alerts:'报警中心',settings:'图层与板块调节'},positions=new Map();let active='overview',width=320,height=560;
for(const [key,section] of Object.entries(sections)){
    const slot=document.createElement('div');slot.className='module-placeholder';section.before(slot);positions.set(key,slot);
    if(key==='settings')continue;
    const heading=section.querySelector('.module-heading'),body=document.createElement('div');body.className='module-content';while(heading.nextSibling)body.appendChild(heading.nextSibling);section.appendChild(body);
    const button=document.createElement('button');button.type='button';button.className='module-fold';button.textContent='⌄';button.setAttribute('aria-label',`展开或收起${titles[key]}`);button.setAttribute('aria-expanded','true');heading.appendChild(button);
    button.addEventListener('click',()=>{const collapsed=section.classList.toggle('module-collapsed');button.setAttribute('aria-expanded',String(!collapsed));});
}
function restore(){if(active==='overview')return;const section=sections[active];positions.get(active).after(section);if(active==='settings')section.hidden=true;}
function open(key){
    restore();active=key;drawer.hidden=key==='overview';document.body.classList.toggle('drawer-open',key!=='overview');
    if(key!=='overview'){const section=sections[key];section.hidden=false;section.classList.remove('module-collapsed');section.querySelector('.module-fold')?.setAttribute('aria-expanded','true');content.replaceChildren(section);$('drawer-title').textContent=titles[key];}
    document.querySelectorAll('[data-drawer]').forEach(button=>{button.classList.toggle('selected',button.dataset.drawer===key);button.setAttribute('aria-expanded',String(button.dataset.drawer===key&&key!=='overview'));});
}
document.querySelector('.command-rail').addEventListener('click',e=>{const button=e.target.closest('[data-drawer]');if(!button)return;const key=button.dataset.drawer;open(key===active?'overview':key);if(key==='overview')window.FactoryTwin?.switchView('overview');});
$('drawer-close').addEventListener('click',()=>open('overview'));document.addEventListener('keydown',e=>{if(e.key==='Escape')open('overview');});
document.querySelectorAll('.home-nav a[href^="#"]').forEach(link=>link.addEventListener('click',e=>{const key=Object.keys(sections).find(key=>'#'+sections[key].id===link.getAttribute('href'));if(key){e.preventDefault();open(key);}}));
function persist(){try{localStorage.setItem('factory-dashboard-layout',JSON.stringify({width,height}));}catch{}}
function setWidth(value){width=Math.min(480,Math.max(270,Math.round(value)));document.body.style.setProperty('--drawer-width',width+'px');$('drawer-width').value=width;$('drawer-width-value').textContent=width+' px';$('drawer-resize').setAttribute('aria-valuenow',width);persist();}
function setHeight(value){height=Math.min(760,Math.max(440,Math.round(value)));document.body.style.setProperty('--scene-height',height+'px');$('scene-height').value=height;$('scene-height-value').textContent=height+' px';persist();}
try{const saved=JSON.parse(localStorage.getItem('factory-dashboard-layout')||'{}');if(Number.isFinite(saved.width))width=saved.width;if(Number.isFinite(saved.height))height=saved.height;}catch{}
setWidth(width);setHeight(height);
$('drawer-width').addEventListener('input',e=>setWidth(Number(e.target.value)));$('scene-height').addEventListener('input',e=>setHeight(Number(e.target.value)));
const resize=$('drawer-resize');let drag;
resize.addEventListener('pointerdown',e=>{drag={x:e.clientX,width};resize.setPointerCapture(e.pointerId);document.body.classList.add('resizing-panel');});resize.addEventListener('pointermove',e=>{if(drag)setWidth(drag.width+e.clientX-drag.x);});resize.addEventListener('pointerup',()=>{drag=null;document.body.classList.remove('resizing-panel');});resize.addEventListener('pointercancel',()=>{drag=null;document.body.classList.remove('resizing-panel');});
resize.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();setWidth(e.key==='Home'?270:e.key==='End'?480:width+(e.key==='ArrowRight'?10:-10));}});
document.querySelectorAll('[data-factory-layer]').forEach(input=>input.addEventListener('change',()=>window.FactoryTwin?.setLayer(input.dataset.factoryLayer,input.checked)));
window.addEventListener('factory-layer-change',e=>{const input=document.querySelector(`[data-factory-layer="${e.detail.kind}"]`);if(input)input.checked=e.detail.enabled;});

// Four recessed fasteners on each structural panel, matching the original shell.
document.querySelectorAll('.home-metrics>div,.scene-card,.command-rail,#dashboard-drawer,.home-module').forEach(el=>{el.classList.add('metal-frame');for(const corner of ['tl','tr','bl','br']){const bolt=document.createElement('i');bolt.className='frame-bolt '+corner;bolt.setAttribute('aria-hidden','true');el.append(bolt);}});
