(()=>{
 const main=document.querySelector('.main');
 const section=document.createElement('section');section.className='management-grid';section.setAttribute('aria-label','设备与人员管理');
 section.innerHTML=`<div class="management-tables">
 <details class="steel-module" id="equipment-management" open><summary><span class="section-icon">▣</span><strong>设备监测</strong><span id="equipment-total" class="module-count">读取中</span><span class="fold-arrow">⌄</span></summary><div class="module-body"><div class="table-tools"><label>搜索设备<input id="equipment-search" placeholder="设备编号 / 类型" type="search"></label><label>风险筛选<select id="equipment-risk"><option value="all">全部状态</option><option value="高">高风险</option><option value="中">中风险 / 需关注</option><option value="低">低风险</option><option value="未知">过期 / 未知</option></select></label></div><div class="table-scroll"><table><thead><tr><th>设备编号</th><th>设备名称</th><th>温度</th><th>负荷</th><th>状态</th><th>操作</th></tr></thead><tbody id="equipment-rows"></tbody></table></div><p class="module-note">使用同一电气观测快照；过期数据不能作为当前安全依据。</p></div></details>
 <details class="steel-module" id="personnel-management" open><summary><span class="section-icon">♟</span><strong>人员管理</strong><span id="personnel-total" class="module-count">读取中</span><span class="fold-arrow">⌄</span></summary><div class="module-body"><div class="table-tools"><label>搜索人员<input id="personnel-search" placeholder="人员编号" type="search"></label><label>位置状态<select id="personnel-filter"><option value="all">全部人员</option><option value="fresh">有效位置</option><option value="stale">过期位置</option><option value="高">高风险区域</option></select></label></div><div class="table-scroll"><table><thead><tr><th>人员编号</th><th>数据来源</th><th>风险 / 位置</th><th>采集时间</th><th>操作</th></tr></thead><tbody id="personnel-rows"></tbody></table></div><p class="module-note">这里只展示已登记位置与风险，不推断姓名、工种或考勤。模拟来源与真实上报分别标记。</p></div></details>
 </div><aside class="construction-poster"><div class="poster-caption"><span>CONSTRUCTION / SAFETY</span><h2>用数据守护<br>每一处作业现场</h2><p>工地装饰示意图 · 非实时监控</p></div></aside>`;
 main.append(section);
 const escape=window.SiteUI.escape;let selectedDevice='',selectedPerson='';
 const sourceName=p=>({demo:'演示台账',simulation_phone:'模拟手机',simulation_camera:'模拟摄像头',telemetry:'接口上报'}[p.source]||'来源未知');
 const badge=(view)=>`<span class="table-status"><i style="background:${view.color}"></i>${escape(view.label)}</span>`;
 function render(){
  const query=document.getElementById('equipment-search').value.trim().toLowerCase(),risk=document.getElementById('equipment-risk').value;
  const devices=state.devices?.filter(d=>(`${d.device_id} ${d.device_type}`).toLowerCase().includes(query)&&(risk==='all'||deviceState(d).level===risk));
  document.getElementById('equipment-total').textContent=state.devices?`${state.devices.length} 台登记 · ${state.devices.filter(d=>window.SiteUI.fresh(d)&&d.status==='online').length} 台有效在线`:'服务断连';
  document.getElementById('equipment-rows').innerHTML=devices?.length?devices.map(d=>`<tr class="${selectedDevice===d.device_id?'row-selected':''}"><td><strong>${escape(d.device_id)}</strong></td><td>${escape(d.device_type)}</td><td>${escape(d.temperature)}℃</td><td>${escape(d.load)}%</td><td>${badge(deviceState(d))}</td><td class="row-actions"><button data-locate-device="${escape(d.device_id)}">⌖ 定位设备</button><button data-detail-device="${escape(d.device_id)}">查看详情</button></td></tr>`).join(''):`<tr><td colspan="6">${state.devices?'没有符合条件的设备':'电气服务不可用，设备状态未知'}</td></tr>`;
  const people=state.spatial?.people,results=new Map((state.spatial?.results||[]).map(r=>[r.person_id,r]));
  const pq=document.getElementById('personnel-search').value.trim().toLowerCase(),pf=document.getElementById('personnel-filter').value;
  const shown=people?.filter(p=>p.person_id.toLowerCase().includes(pq)&&(pf==='all'||pf==='fresh'&&window.SiteUI.fresh(p)||pf==='stale'&&!window.SiteUI.fresh(p)||pf==='高'&&personState(p,results.get(p.person_id)).level==='高'));
  document.getElementById('personnel-total').textContent=people?`${people.length} 人登记 · ${people.filter(p=>window.SiteUI.fresh(p)).length} 人位置有效`:'服务断连';
  document.getElementById('personnel-rows').innerHTML=shown?.length?shown.map(p=>`<tr class="${selectedPerson===p.person_id?'row-selected':''}"><td><strong>${escape(p.person_id)}</strong></td><td>${sourceName(p)}</td><td>${badge(personState(p,results.get(p.person_id)))}</td><td>${escape(localTime(p.timestamp))}</td><td class="row-actions"><button data-locate-person="${escape(p.person_id)}">⌖ 定位人员</button><button data-detail-person="${escape(p.person_id)}">查看详情</button></td></tr>`).join(''):`<tr><td colspan="5">${people?'没有符合条件的人员':'空间服务不可用，人员状态未知'}</td></tr>`;
 }
 function showOnMap(lng,lat,info){document.querySelector('.stage-card').scrollIntoView({behavior:'smooth',block:'start'});if(state.mode==='3d')scene?.focus(lng,lat);else map.setView([lat,lng],19);showDetail(info);}
 section.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  const did=b.dataset.locateDevice||b.dataset.detailDevice,pid=b.dataset.locatePerson||b.dataset.detailPerson;
  if(did){const d=state.devices?.find(d=>d.device_id===did);if(!d)return;selectedDevice=did;showOnMap(...d.location,{title:`${d.device_id} ${d.device_type}`,text:`${deviceState(d).label}；${d.alert}。温度 ${d.temperature}℃，负荷 ${d.load}%，漏电 ${d.leakage}mA。采集：${d.timestamp}。`});}
  if(pid){const p=state.spatial?.people.find(p=>p.person_id===pid);if(!p)return;selectedPerson=pid;const r=state.spatial.results.find(r=>r.person_id===pid);showOnMap(p.lng,p.lat,{title:p.person_id,text:`${sourceName(p)} · ${personState(p,r).label}。${window.SiteUI.fresh(p)?r?.alert||'':'仅为最后已知位置。'}采集：${p.timestamp}。`});}
  render();
 });
 section.querySelectorAll('input,select').forEach(el=>el.addEventListener(el.tagName==='INPUT'?'input':'change',render));
 const nav=document.querySelector('.command-rail');
 nav.addEventListener('click',e=>{const b=e.target.closest('[data-drawer]');if(!b||!['devices','people'].includes(b.dataset.drawer))return;e.stopImmediatePropagation();if(document.getElementById('presentation-mode').getAttribute('aria-pressed')==='true')document.getElementById('presentation-mode').click();nav.querySelectorAll('button').forEach(item=>item.classList.toggle('selected',item===b));const target=document.getElementById(b.dataset.drawer==='devices'?'equipment-management':'personnel-management');target.open=true;target.scrollIntoView({behavior:'smooth',block:'start'});},true);
 window.SiteManagement={render};render();
 // Visible screw heads on the structural frame, never over controls.
 document.querySelectorAll('.metric,.stage-card,.command-rail,.steel-module,.construction-poster,.sidebar').forEach(el=>{el.classList.add('bolted-frame');for(const corner of ['tl','tr','bl','br']){const screw=document.createElement('i');screw.className=`frame-bolt ${corner}`;screw.setAttribute('aria-hidden','true');el.append(screw);}});
})();
