// The homepage card, rail badge and list share this A/B personnel-only scope.
export function personnelSafetySnapshot(data){
 const people=new Set((data.entities||[]).filter(e=>e.kind==='person'&&['a','b'].includes(e.view)).map(e=>e.id));
 const included=alarm=>people.has(alarm.entityId)&&['a','b'].includes(alarm.view);
 return {active:(data.active||[]).filter(included),events:(data.events||[]).filter(included),added:[],people:people.size};
}
