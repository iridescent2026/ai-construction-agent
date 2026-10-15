import {mountCockpit} from './cockpit.mjs?v=46';
// Keep controls outside the live canvas, and settings beside the map.
export function refineLayout(root,twin){
 const node=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls;if(text)n.textContent=text;return n;};
 const viewport=root.querySelector('.ws-viewport'),scene=viewport.querySelector(twin?'.scene-card':'.ws-gis-scene');
 const tools=node('div','ws-view-toolbar'),tabs=scene.querySelector(twin?'.view-tabs':'.view-buttons');
 if(tabs)tools.append(tabs);
 const actions=scene.querySelector(twin?'.scene-heading':'.scene-head .actions');if(actions)tools.append(actions);
 scene.prepend(tools);
 const footer=node('div','ws-view-footer'),info=node('div','ws-view-information');
 const caption=scene.querySelector(twin?'.scene-footer':'.map-note');if(caption)info.append(caption);
 footer.append(info);const buttons=node('div','ws-view-action-buttons');buttons.append(root.querySelector('#ws-fullscreen'));footer.append(buttons);
 const stage=scene.querySelector(twin?'#factory-stage':'.stage-wrap');stage.after(footer);
 if(!twin){
  for(const [id,title]of [['Z001','土方施工区'],['Z002','吊装作业区']]){const b=node('button','ws-zone-focus',title);b.type='button';b.onclick=async()=>{await window.GisWorkspace?.showView('3d');await window.GisWorkspace?.locate(id);};actions?.append(b);}
  const right=root.querySelector('.ws-right'),panel=node('section','ws-layer-panel');panel.hidden=true;panel.setAttribute('aria-label','图层与空间设置');
  const heading=node('div','ws-layer-heading'),title=node('h2','','图层与空间设置'),close=node('button','','×');close.type='button';close.setAttribute('aria-label','关闭图层设置');heading.append(title,close);panel.append(heading,node('p','ws-layer-hint','地图保持可见，调整即时生效。'));
  const layers=document.querySelector('.sidebar .layers');if(layers)panel.append(layers);
  for(const id of ['panel-width','stage-height']){const input=document.getElementById(id),label=document.querySelector(`label[for="${id}"]`);if(label)panel.append(label);if(input)panel.append(input);}
  const reset=node('button','ws-layer-reset','恢复默认布局');reset.type='button';reset.onclick=()=>{root.style.removeProperty('--ws-right-width');viewport.style.removeProperty('height');viewport.style.removeProperty('max-height');viewport.style.removeProperty('align-self');window.dispatchEvent(new Event('resize'));};panel.append(reset);right.append(panel);
  window.addEventListener('workspace-open-layers',()=>{root.classList.remove('ws-focus-view');panel.hidden=false;window.dispatchEvent(new Event('resize'));});close.onclick=()=>panel.hidden=true;
 }
 const home=root.querySelector('.ws-home-link');home.textContent='⌂  返回首页';
 const avatar=document.getElementById('account-avatar');
 // Preserve initials and engineer choices; give the helmet choice a designed icon.
 const helmet=()=>{if(avatar.textContent==='⛑'){avatar.innerHTML='<svg viewBox="0 0 56 56" aria-hidden="true"><defs><linearGradient id="helmet-gold" x2="1" y2="1"><stop stop-color="#fff0ac"/><stop offset=".5" stop-color="#eeb63e"/><stop offset="1" stop-color="#8d5916"/></linearGradient></defs><path d="M8 53q2-15 20-15t20 15" fill="#b48232" stroke="#ffdf89"/><path d="m19 40 9 11 9-11-3-8H22z" fill="#d5a075"/><ellipse cx="28" cy="27" rx="11" ry="15" fill="#dcb488"/><path d="M14 26V23Q14 8 28 8T42 23v3z" fill="url(#helmet-gold)" stroke="#ffe7a1"/><path d="M26 8h5v17h-5zM10 26q18 7 36 0v4q-18 6-36 0z" fill="url(#helmet-gold)" stroke="#ffdb7b"/><path d="m19 40 9 11-4 5H12zm18 0-9 11 4 5h12z" fill="#202c35" stroke="#b39a59"/></svg>';}};helmet();new MutationObserver(helmet).observe(avatar,{childList:true});
 mountCockpit(root,twin);
}
