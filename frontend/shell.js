(()=>{
 const workspace=document.querySelector('.workspace'),aside=document.querySelector('.sidebar');
 const legend=document.querySelector('.legend'),sensor=document.querySelector('.sensor-panel'),panel=document.querySelector('.panel');
 document.querySelector('.brand').innerHTML='<img class="brand-logo" src="logo.png" alt="工安智瞳 · Construction Safety AI">';
 const mode=document.createElement('button');mode.id='presentation-mode';mode.textContent='进入演示模式';mode.setAttribute('aria-pressed','false');document.querySelector('.top-actions').prepend(mode);
 const nav=document.createElement('nav');nav.className='command-rail';nav.setAttribute('aria-label','工作台导航');
 nav.innerHTML='<div class="rail-caption">CONTROL</div>'+[['overview','◈','全景'],['zones','▱','区域'],['devices','▣','设备监测'],['people','♟','人员管理'],['assistant','⌘','助手'],['sensor','◉','感知'],['legend','▤','图层']].map(([id,icon,label])=>`<button data-drawer="${id}" aria-expanded="false"><span aria-hidden="true">${icon}</span>${label}</button>`).join('');workspace.prepend(nav);
 const head=document.createElement('div');head.className='drawer-head';head.innerHTML='<strong id="drawer-title">现场感知</strong><button id="drawer-close" aria-label="收起功能面板">›</button>';aside.prepend(head);
 const legendDetails=document.createElement('details');legendDetails.className='floating-legend';legendDetails.innerHTML='<summary><span class="swatch high"></span> 高 <span class="swatch medium"></span> 中 <span class="swatch low"></span> 低 <span class="swatch unknown"></span> 未知 <b>图例 ▴</b></summary>';
 document.querySelector('.stage-body').append(legendDetails);legendDetails.append(legend);
 const footer=document.createElement('details');footer.className='observation-tray';footer.innerHTML='<summary>观测信息与展示说明 <span>展开 ▴</span></summary><div class="tray-content"></div>';document.querySelector('.main').append(footer);footer.querySelector('div').append(document.querySelector('.view-help'));
 let active='overview',presentation=false;
 function resize(){map.invalidateSize();scene?.resize();}
 function open(name){
  active=name;const closed=name==='overview';workspace.classList.toggle('drawer-open',!closed);aside.hidden=closed;
  sensor.hidden=name!=='sensor';panel.hidden=!['zones','devices','assistant'].includes(name);
  if(name==='legend'){legendDetails.open=!legendDetails.open;active='overview';aside.hidden=true;workspace.classList.remove('drawer-open');}
  const titles={zones:'区域监测',devices:'设备监测',assistant:'巡检与智能助手',sensor:'现场感知 · 模拟联动'};document.getElementById('drawer-title').textContent=titles[name]||'功能面板';
  if(['zones','devices','assistant'].includes(name))selectTab(document.querySelector(`[data-tab="${name}"]`));
  nav.querySelectorAll('button').forEach(b=>{const selected=b.dataset.drawer===active;b.classList.toggle('selected',selected);b.setAttribute('aria-expanded',selected&&active!=='overview'?'true':'false');});
  requestAnimationFrame(resize);
 }
 nav.addEventListener('click',e=>{const b=e.target.closest('[data-drawer]');if(b){open(active===b.dataset.drawer?'overview':b.dataset.drawer);document.querySelector('.main').scrollIntoView({behavior:'smooth',block:'start'});}});
 document.getElementById('drawer-close').addEventListener('click',()=>open('overview'));
 document.querySelectorAll('#panel-tabs [data-tab]').forEach(button=>button.addEventListener('click',()=>open(button.dataset.tab)));
 mode.addEventListener('click',()=>{presentation=!presentation;workspace.classList.toggle('presentation',presentation);mode.setAttribute('aria-pressed',String(presentation));mode.textContent=presentation?'退出演示模式':'进入演示模式';open(presentation?'sensor':'overview');if(presentation)setMode('3d');});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){open('overview');legendDetails.open=false;}});
 // A collapsed simulator keeps its stop control accessible without reopening the drawer.
 const dock=document.createElement('div');dock.className='simulation-dock';dock.innerHTML='<span>模拟轨迹运行中</span><button type="button">停止</button>';dock.hidden=true;document.querySelector('.stage-body').append(dock);
 dock.querySelector('button').addEventListener('click',()=>document.getElementById('motion-stop').click());
 new MutationObserver(()=>{dock.hidden=document.getElementById('motion-stop').disabled;}).observe(document.getElementById('motion-stop'),{attributes:true,attributeFilter:['disabled']});
 new ResizeObserver(resize).observe(document.querySelector('.stage-body'));
 open('overview');
})();
