// One read-only state request per refresh; every visible module reports its outcome.
export function createRefreshController({readState,onStart=()=>{},onFinish=()=>{}}){
 const participants=new Map();let pending;
 return {
  register(name,handler){participants.set(name,handler);return()=>participants.delete(name);},
  refresh(){
   if(pending)return pending;
   pending=(async()=>{
    onStart();let state;
    try{state=await readState();if(!Number.isFinite(state?.revision)||!Array.isArray(state.entities))throw new Error('后台返回的观测格式无效');}
    catch(error){for(const handler of participants.values())handler.offline?.(error);throw error;}
    const entries=[...participants],results=await Promise.allSettled(entries.map(async([,handler])=>{await handler.apply?.(state);await handler.read?.(state);}));
    return {revision:state.revision,updatedAt:state.updatedAt,completed:entries.filter((_,i)=>results[i].status==='fulfilled').map(([name])=>name),failures:entries.flatMap(([name],i)=>results[i].status==='rejected'?[{name,message:results[i].reason?.message||String(results[i].reason)}]:[])};
   })().finally(()=>{pending=null;onFinish();});return pending;
  }
 };
}
