import {factoryRequest,factorySession} from './factory-client.mjs';
import {factoryRefresh} from './factory-refresh.mjs';
import {initBusinessEvidence} from './business-evidence.mjs';
const roles={safety:'安全员',maintenance:'维修员',reviewer:'复核员',observer:'只读员',collector:'采集账号',admin:'管理员'};

export function initDeviceWorkflow(host){
 const panel=document.createElement('section');panel.id='device-workflow';panel.className='workflow-console';
 panel.innerHTML=`<div class="workflow-heading"><div><span class="eyebrow">DEVICE INVESTIGATION / B-05</span><h3>设备异常处置 · 核查任务助手</h3><p>观测 → 候选影响 → 人员与作业 → 确认派单 → 维修复核</p></div><button id="workflow-refresh">更新核查依据</button></div>
 <div class="workflow-identity"><span id="workflow-user">读取当前岗位…</span><p>操作沿用顶部登录身份；切换岗位请使用顶部账号菜单。</p></div>
 <div class="analysis-controls"><label>核查设备<select id="workflow-entity"><option value="B-05">B-05 · 循环排水泵组</option></select></label><label class="workflow-test-rule"><input id="workflow-test-rule" type="checkbox"> 使用流程测试条件（60℃，非工程限值）</label><button id="workflow-highlight">查看关联对象</button></div>
 <p id="workflow-status" role="status">正在读取同源观测…</p><div id="workflow-facts" class="workflow-facts"></div><details><summary>最小台账与待核验依据</summary><div id="workflow-ledger"></div></details>
 <div class="workflow-questions analysis-controls"><button data-workflow-question="现在是什么状态？">1 状态</button><button data-workflow-question="可能影响哪里？">2 候选影响</button><button data-workflow-question="涉及哪些人员和作业？">3 人员与作业</button><button data-workflow-question="帮我安排核查任务。">4 核查草案</button><button data-workflow-question="处理后怎么关闭？">5 维修复核</button></div>
 <p id="workflow-language-status" class="account-note">语言理解：读取配置…</p><form id="workflow-ask" class="workflow-ask"><label>任务问题<input id="workflow-query" maxlength="2000" value="B-05 现在是什么状态？" required></label><button>执行查询</button></form><p id="workflow-answer" role="status">问答会执行后台工具，并显示实际结果；不会直接操作现场设备。</p>
 <details><summary>实际工具执行记录（规则编排）</summary><div id="workflow-tools"></div></details>
 <div id="workflow-draft" class="workflow-draft" hidden><h4>待确认的核查草案</h4><p id="workflow-draft-text"></p><label>指派维修账号<select id="workflow-assignee"></select></label><button id="workflow-confirm">确认并创建核查工单</button><p>确认前重新核对观测有效性与台账。聊天生成草案不等于已派单；草案五分钟过期。</p></div>
 <p class="analysis-boundary">这是带证据的规则工具编排原型。连接、工程规则、实际组织岗位待现场核验；无规则返回待核验，缺失或过期返回未知。</p>`;
 host.querySelector('.module-heading').after(panel);
 initBusinessEvidence(panel);
 const $=id=>panel.querySelector('#'+id),node=(tag,value)=>{const n=document.createElement(tag);n.textContent=value;return n;};
 let current=null,draft=null,sequence=0;
 function message(value,bad=false){$('workflow-status').textContent=value;$('workflow-status').classList.toggle('error',bad);}
 async function run(button,operation){if(button)button.disabled=true;try{await operation();}catch(e){message(e.message,true);}finally{if(button)button.disabled=false;}}
 function renderCase(value){current=value;const o=value.observation,names={temperature:'温度',pressure:'压力',voltage:'电压',current:'电流',leakage:'漏电',load:'负荷'},readings=Object.entries(o.measurements).map(([k,m])=>(names[k]||k)+' '+m.value+m.unit).join(' · ')||'无读数';
  $('workflow-facts').replaceChildren(...[o.title+' · '+o.statusLabel,readings+' · 流量未接入',o.source+' · 采集 '+(o.observedAt?new Date(o.observedAt).toLocaleString():'未知'),`同源观测 v${value.factoryRevision} · 核查 ${new Date(value.capturedAt).toLocaleString()}`].map(v=>node('p',v)));
  $('workflow-ledger').replaceChildren(...value.ledger.map(r=>node('p',`${r.field}：${r.status} · ${r.basis}`)));
  $('workflow-tools').replaceChildren(...value.toolResults.map(t=>node('p',`${t.tool} · ${t.status} · 观测 v${t.factoryRevision}${t.elapsedMs==null?'':' · '+t.elapsedMs+' ms'} · 输入 ${JSON.stringify(t.input)} · 结果 ${JSON.stringify(t.output)}`)));
  message(o.statusLabel+' · '+o.rule.basis);
 }
 async function refresh(){const serial=++sequence,id=$('workflow-entity').value,value=await factoryRequest('/workflow/case/'+encodeURIComponent(id)+'?useTestRule='+$('workflow-test-rule').checked);if(serial===sequence)renderCase(value);}
 factoryRefresh.register('核查依据',{read:async()=>{if(!$('workflow-entity').value)throw new Error('设备台账尚在加载，请稍候重试');await refresh();}});
 function renderDraft(value){draft=value;$('workflow-confirm').disabled=!!value?.case?.maintenanceCheck?.blocked;$('workflow-draft').hidden=!value;if(value)$('workflow-draft-text').textContent=`${value.id} · ${value.entityId} · ${value.reason} · 依据 v${value.case.factoryRevision} / ${value.case.observation.statusLabel} · 尚未创建工单`;}
 async function ask(query){const serial=++sequence;const result=await factoryRequest('/workflow/chat',{query,entityId:$('workflow-entity').value,useTestRule:$('workflow-test-rule').checked});if(serial!==sequence)return;$('workflow-answer').textContent=result.answer;if(result.case)renderCase(result.case);if(result.draft)renderDraft(result.draft);}
 async function accounts(){const session=factorySession();$('workflow-user').textContent=session?.user?`${session.user.name} · ${roles[session.user.role]} · ${session.user.id}`:'未登录 · 可以查询，派单需登录';
  if(session){const users=await factoryRequest('/auth/users');$('workflow-assignee').replaceChildren(...users.filter(u=>u.role==='maintenance').map(u=>{const option=node('option',u.name+' · '+u.id);option.value=u.id;return option;}));}else $('workflow-assignee').replaceChildren();
 }


 $('workflow-refresh').addEventListener('click',e=>run(e.currentTarget,refresh));
 for(const id of ['workflow-entity','workflow-test-rule'])$(id).addEventListener('change',()=>{renderDraft(null);run(null,refresh);});
 $('workflow-ask').addEventListener('submit',e=>{e.preventDefault();run(e.submitter,()=>ask($('workflow-query').value));});
 panel.querySelectorAll('[data-workflow-question]').forEach(b=>b.addEventListener('click',()=>run(b,()=>ask($('workflow-entity').value+' '+b.dataset.workflowQuestion))));
 $('workflow-highlight').addEventListener('click',()=>{if(current)window.dispatchEvent(new CustomEvent('analysis-highlight',{detail:current.impact}));});
 $('workflow-confirm').addEventListener('click',e=>run(e.currentTarget,async()=>{if(!draft)throw new Error('请先生成核查草案');const result=await factoryRequest('/workflow/drafts/'+draft.id+'/confirm',{assignee:$('workflow-assignee').value});renderDraft(null);$('workflow-answer').textContent=`${result.alreadyConfirmed?'此前已经创建':'已创建并指派'} ${result.order.id} → ${result.order.assignee}。尚未执行现场处理，请在维修闭环中继续。`;window.dispatchEvent(new CustomEvent('workflow-order-created',{detail:result.order}));await refresh();}));
 window.addEventListener('factory-auth-change',()=>{sequence++;renderDraft(null);run(null,accounts);});
 window.addEventListener('business-evidence-change',()=>{renderDraft(null);run(null,refresh);});
 window.addEventListener('workflow-chat-result',e=>{const result=e.detail;$('workflow-answer').textContent=result.answer;if(result.case)renderCase(result.case);if(result.draft)renderDraft(result.draft);});
 window.addEventListener('factory-select',e=>{if(e.detail?.kind==='device'&&[...$('workflow-entity').options].some(o=>o.value===e.detail.id)){$('workflow-entity').value=e.detail.id;renderDraft(null);run(null,refresh);}});
 run(null,async()=>{const [mode,data]=await Promise.all([factoryRequest('/auth/mode'),factoryRequest()]);$('workflow-test-rule').disabled=!mode.simulationEnabled;const language=$('workflow-language-status');if(language)language.textContent=mode.language?.configured?'大模型分类已配置；实际调用与回退见工具记录，规则与权限仍由后台执行。':'词典与上下文理解；支持多项查询和缺失条件追问，未配置大模型。';
  const entities=data.entities.filter(e=>e.kind==='device'&&(!document.body.classList.contains('factory-home')||e.view!=='overview'));$('workflow-entity').replaceChildren(...entities.map(e=>{const option=node('option',e.id+' · '+e.title);option.value=e.id;return option;}));$('workflow-entity').value='B-05';

  await accounts();await refresh();
 });
}
