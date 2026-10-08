export function steelPanel(el){
 if(!el)return;el.classList.add('steel-panel');
 el.querySelectorAll(':scope>.frame-bolt,:scope>.gis-bolt,:scope>.analysis-bolt').forEach(n=>n.remove());
 for(const corner of ['tl','tr','bl','br'])if(!el.querySelector(':scope>.steel-bolt.'+corner)){const bolt=document.createElement('i');bolt.className='steel-bolt '+corner;bolt.setAttribute('aria-hidden','true');el.append(bolt);}
}
document.body.dataset.industrialTheme='steel';
document.querySelectorAll('.metal,.metal-frame,.scene-card,.home-module,.home-metrics>div,.command-rail,#dashboard-drawer,#factory-analysis').forEach(steelPanel);
const header=document.querySelector('header');if(header){header.classList.add('app-header');const brand=header.querySelector('a');brand.className='brand-lockup';brand.setAttribute('aria-label','工安智瞳首页');brand.innerHTML='<span class="brand-emblem" aria-hidden="true"></span><span class="brand-type"><span class="brand-title">工安智瞳</span><span class="brand-subtitle">CONSTRUCTION SAFETY AI</span></span>';const motto=header.querySelector('p,.brand-motto');if(motto)motto.classList.add('brand-motto');}
if(header){const update=()=>document.body.style.setProperty('--app-header-height',header.getBoundingClientRect().height+'px');update();const observer=new ResizeObserver(update);observer.observe(header);window.addEventListener('pagehide',e=>{if(!e.persisted)observer.disconnect();});}
