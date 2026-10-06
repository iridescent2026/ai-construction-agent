export function containsPoint(zone,x,z){
    return Number.isFinite(x)&&Number.isFinite(z)&&Math.abs(x-zone.center[0])<=zone.size[0]/2&&Math.abs(z-zone.center[1])<=zone.size[1]/2;
}

// Occupancy uses scene coordinates and remains independent of visible layers.
export function evaluateOccupancy(entity,zones){
    if(entity.kind!=='person'&&!entity.mobile)return {state:'not-applicable',zones:[]};
    const anchor=entity.anchor;
    if(!anchor||!Number.isFinite(anchor[0])||!Number.isFinite(anchor[2]))return {state:'unknown',zones:[]};
    const hits=zones.filter(zone=>zone.view===entity.view&&containsPoint(zone,anchor[0],anchor[2])&&!(entity.allowedZones||[]).includes(zone.id));
    return {state:hits.length?'danger':'clear',zones:hits.map(zone=>zone.id)};
}

export class FactorySafety{
    constructor(entities){this.entities=entities;this.states=new Map();this.events=[];this.active=[];this.sequence=0;}
    evaluate(now=Date.now()){
        const zones=this.entities.filter(item=>item.kind==='zone'),added=[];
        for(const entity of this.entities){
            const result=evaluateOccupancy(entity,zones);if(result.state==='not-applicable')continue;
            const previous=this.states.get(entity.id);
            if(result.state==='unknown')result.zones=previous?.zones||[];
            for(const zoneId of result.zones)if(!previous?.zones.includes(zoneId))added.push(this.event('enter',entity,zoneId,now));
            for(const zoneId of previous?.zones||[])if(!result.zones.includes(zoneId)&&result.state!=='unknown')added.push(this.event('leave',entity,zoneId,now));
            entity.riskState=result.state;entity.currentZones=result.zones;
            this.states.set(entity.id,{...result,since:previous&&(previous.state===result.state||result.state==='unknown')?previous.since:now});
        }
        this.events.unshift(...added.reverse());this.events=this.events.slice(0,40);
        this.active=[];
        for(const entity of this.entities)for(const zoneId of entity.currentZones||[]){const zone=zones.find(z=>z.id===zoneId);this.active.push({id:`${entity.id}:${zoneId}`,entityId:entity.id,title:entity.title,role:entity.role,kind:entity.kind,state:entity.riskState,zoneId,zoneTitle:zone.title,view:entity.view,time:this.states.get(entity.id).since});}
        return {active:this.active,events:this.events,added,people:this.entities.filter(i=>i.kind==='person').length};
    }
    event(type,entity,zoneId,time){return {id:++this.sequence,type,entityId:entity.id,title:entity.title,zoneId,view:entity.view,time};}
}

export const DEMO_PATHS={
    overview:{id:'P023',view:'overview',label:'总览 · 施工工人',points:[[-41,12],[-35,12],[-28,19],[-28,23]]},
    vehicle:{id:'E-04',view:'overview',label:'总览 · 工程运输车',points:[[55,5],[55,14],[43,14],[35,14]]},
    a:{id:'P005',view:'a',label:'A 区 · 装配工',points:[[-12,-.6],[-12,-3],[-12,-6.5],[-12,-7]]},
    b:{id:'P016',view:'b',label:'B 区 · 电工',points:[[-2,-.6],[-2,-3],[-2,-6],[-2,-7]]}
};
export function demoPosition(path,seconds){
    const duration=12,phase=(seconds%(duration*2))/duration,t=phase<=1?phase:2-phase;
    const segment=t*(path.points.length-1),index=Math.min(path.points.length-2,Math.floor(segment)),fraction=segment-index;
    return path.points[index].map((value,axis)=>value+(path.points[index+1][axis]-value)*fraction);
}
