export const factoryBase=window.APP_CONFIG?.gis||'http://127.0.0.1:8000';
export async function factoryRequest(path='/state',body){
    const response=await fetch(`${factoryBase}/factory${path}`,{cache:'no-store',signal:AbortSignal.timeout(4000),...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
    if(!response.ok){let message=`后台请求失败 ${response.status}`;try{message=(await response.json()).detail||message;}catch{}throw new Error(message);}
    return response.json();
}
export function watchFactory(onData,onError){
    let stopped=false,timer;
    async function poll(){try{const data=await factoryRequest();if(!stopped)onData(data);}catch(error){if(!stopped)onError(error);}finally{if(!stopped)timer=setTimeout(poll,1000);}}
    poll();return()=>{stopped=true;clearTimeout(timer);};
}
export function freshFactory(timestamp){const age=Date.now()-Date.parse(timestamp);return Number.isFinite(age)&&age>=-5000&&age<=120000;}
export function measurementText(info){
    if(!info.measurements)return '测量数据待接入';
    const names={temperature:'温度',load:'负荷',pressure:'压力',current:'电流',voltage:'电压',leakage:'漏电',speed:'速度'};
    const values=Object.entries(info.measurements).map(([k,m])=>`${names[k]||k} ${m.value}${m.unit}`).join(' · ');
    return `${freshFactory(info.measurementTimestamp)?'':'已过期 · '}${info.measurementSource==='telemetry'?'接口上报':'演示传感数据'} · ${values}`;
}
