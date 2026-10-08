import {freshFactory} from './factory-client.mjs';

export function factorySnapshot(data, offline=false, capturedAt=null) {
    const entities=(data?.entities||[]).map(e=>({...e,
        riskState:offline||((e.kind==='person'||e.mobile)&&!(capturedAt?Number.isFinite(Date.parse(e.positionTimestamp))&&Date.parse(capturedAt)-Date.parse(e.positionTimestamp)>=-5000&&Date.parse(capturedAt)-Date.parse(e.positionTimestamp)<=120000:freshFactory(e.positionTimestamp)))?'unknown':e.riskState}));
    const ids=new Set(entities.map(e=>e.id));
    const active=(data?.active||[]).filter(a=>ids.has(a.entityId))
        .map(a=>({...a,state:entities.find(e=>e.id===a.entityId)?.riskState==='unknown'?'unknown':a.state}));
    return {...data,entities,active,events:data?.events||[]};
}

export function outdoorSnapshot(data, offline=false, capturedAt=null) {
    const snapshot=factorySnapshot(data,offline,capturedAt);
    return {...snapshot,entities:snapshot.entities.filter(e=>e.view==='overview'),
        active:snapshot.active.filter(a=>a.view==='overview'),
        events:snapshot.events.filter(e=>e.view==='overview')};
}

// Ignore delayed HTTP responses so a manual refresh cannot roll back a newer poll.
export function acceptsRevision(current,incoming) {
    if(!incoming||!Number.isFinite(incoming.revision))return false;
    return !current||incoming.instanceId&&incoming.instanceId!==current.instanceId||incoming.revision>=current.revision;
}
