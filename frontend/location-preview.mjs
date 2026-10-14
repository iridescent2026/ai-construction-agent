// Reuse the real scene in a local preview; retain list, filters and page position.
const scene=document.querySelector('.scene-card')||document.querySelector('.scene-head')?.closest('.metal');
if(scene){
 const slot=document.createComment('scene-original-position');scene.before(slot);
 const panel=document.createElement('section');panel.className='location-preview';panel.hidden=true;panel.setAttribute('aria-label','局部定位预览');
 const header=document.createElement('div');header.className='location-preview-heading';const title=document.createElement('strong'),back=document.createElement('button');back.textContent='返回列表位置';back.type='button';header.append(title,back);panel.append(header);document.body.append(panel);let saved;
 function capture(){const active=document.activeElement,containers=[document.getElementById('drawer-content'),document.getElementById('dashboard-drawer')].filter(Boolean);return{y:scrollY,x:scrollX,scroll:containers.map(e=>({e,top:e.scrollTop})),label:active?.getAttribute('aria-label')};}
 function close(){if(panel.hidden)return;window.FactoryTwin?.exitInspection();slot.parentNode.insertBefore(scene,slot.nextSibling);panel.hidden=true;document.body.classList.remove('location-preview-open');const state=saved;saved=null;if(state){for(const s of state.scroll)s.e.scrollTop=s.top;window.scrollTo({left:state.x,top:state.y,behavior:'instant'});if(state.label)document.querySelector(`[aria-label="${CSS.escape(state.label)}"]`)?.focus({preventScroll:true});}}
 function open(info,context){if(panel.hidden){saved=context||capture();panel.hidden=false;document.body.classList.add('location-preview-open');panel.append(scene);}title.textContent=(info?.id||'关联对象')+' · '+(info?.title||'空间核查')+' · 列表位置保留';}
 back.onclick=close;document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden&&!document.getElementById('factory-stage')?.classList.contains('walking')){e.preventDefault();e.stopPropagation();close();}},true);
 window.FactoryLocation={open,close,capture,isOpen:()=>!panel.hidden};
}
