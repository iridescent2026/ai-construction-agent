export const factoryBase=window.APP_CONFIG?.gis||'http://127.0.0.1:8000';
export function factorySession(){try{return JSON.parse(globalThis.sessionStorage?.getItem('factory-session')||'null');}catch{return null;}}
export function setFactorySession(value){if(value)globalThis.sessionStorage?.setItem('factory-session',JSON.stringify(value));else globalThis.sessionStorage?.removeItem('factory-session');globalThis.dispatchEvent?.(new CustomEvent('factory-auth-change',{detail:value}));}
export function observationSource(info,field='measurement'){if(info[field+'Source']==='demo')return '后台模拟';const kind=info[field+'Provenance']?.kind;return kind==='manual'?'手动测试导入':kind==='authenticated_import'?'采集账号导入（设备未核验）':info[field+'Source']==='telemetry'?'旧接口记录（来源未核验）':'未接入';}
export async function factoryRequest(path='/state',body){
    const session=factorySession(),headers={...(body?{'Content-Type':'application/json'}:{}),...(session?.token?{Authorization:'Bearer '+session.token}:{}),...(globalThis.sessionStorage?.getItem('factory-workspace')?{'X-Demo-Workspace':sessionStorage.getItem('factory-workspace')}:{})};
    let response;
    for(let attempt=0;attempt<(body?1:2);attempt++){
        try{
            response=await fetch(`${factoryBase}/factory${path}`,{cache:'no-store',signal:AbortSignal.timeout(18000),headers,...(body?{method:'POST',body:JSON.stringify(body)}:{})});
            if(!body&&response.status===503&&attempt===0)continue;
            break;
        }catch(error){
            const transient=['TimeoutError','AbortError','TypeError'].includes(error.name);
            if(!body&&transient&&attempt===0)continue;
            if(transient)throw new Error(body?'提交请求等待超时，请刷新核对是否已保存后再决定重试。':'网络响应较慢，请点击刷新数据重试。');
            throw error;
        }
    }
    if(response.status===401&&path!=='/auth/login')setFactorySession(null);
    if(!response.ok){let message=`后台请求失败 ${response.status}`;try{const detail=(await response.json()).detail;message=Array.isArray(detail)?detail.map(e=>e.msg).join('；'):detail||message;}catch{}const error=new Error(message);error.status=response.status;error.url=response.url;throw error;}
    return response.json();
}
export function watchFactory(onData,onError){
    let stopped=false,timer;
    async function poll(){try{const data=await factoryRequest();if(!stopped)onData(data);}catch(error){if(!stopped)onError(error);}finally{if(!stopped)timer=setTimeout(poll,1000);}}
    poll();return()=>{stopped=true;clearTimeout(timer);};
}
export function freshFactory(timestamp,capturedAt=null){const age=(capturedAt?Date.parse(capturedAt):Date.now())-Date.parse(timestamp);return Number.isFinite(age)&&age>=-5000&&age<=120000;}
export function measurementText(info,capturedAt=null){
    if(!info.measurements)return '测量数据待接入';
    const names={temperature:'温度',load:'负荷',pressure:'压力',current:'电流',voltage:'电压',leakage:'漏电',speed:'速度'};
    const values=Object.entries(info.measurements).map(([k,m])=>`${names[k]||k} ${m.value}${m.unit}`).join(' · ');
    return `${info.measurementNote?info.measurementNote+' · ':''}${freshFactory(info.measurementTimestamp,capturedAt)?'':'已过期 · '}${observationSource(info)} · ${values}`;
}
