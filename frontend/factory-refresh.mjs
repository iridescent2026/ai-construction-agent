import {factoryRequest} from './factory-client.mjs';
import {createRefreshController} from './refresh-controller.mjs';
const buttons=['data-refresh','refresh-observations'].map(id=>document.getElementById(id)).filter(Boolean);
let busy=false;
function message(value,error=false){for(const button of buttons){const status=document.getElementById(button.id+'-result');if(status){status.textContent=value;status.classList.toggle('refresh-error',error);}}}
export const factoryRefresh=createRefreshController({
 readState:()=>factoryRequest(),
 onStart(){busy=true;for(const button of buttons){button.disabled=true;button.setAttribute('aria-busy','true');}window.dispatchEvent(new CustomEvent('analysis-replay',{detail:{data:null}}));message('正在读取最新观测、分析和核查依据…');},
 onFinish(){busy=false;for(const button of buttons){button.disabled=false;button.setAttribute('aria-busy','false');}}
});
for(const button of buttons){
 button.title='重新读取后台观测、分析和核查依据；不会生成新的传感器读数。';
 button.addEventListener('click',async()=>{
  if(busy)return;
  try{const result=await factoryRefresh.refresh(),clock=new Date().toLocaleTimeString('zh-CN',{hour12:false});
   message(result.failures.length?`部分已刷新 · ${clock} · 观测 v${result.revision}；未完成：${result.failures.map(f=>f.name+'（'+f.message+'）').join('、')}`:`刷新完成 · ${clock} · 读取观测 v${result.revision} · ${result.completed.join(' / ')}。新读数需运行模拟或导入观测。`,!!result.failures.length);
  }catch(error){message('刷新失败：'+error.message+'；当前状态以各模块断连/未知提示为准。',true);}
 });
}
