export function geoPoint(data,view,x,z){const [ox,oz,scale]=data.coordinateSystem.frames[view],origin=data.coordinateSystem.origin;const r=data.coordinateSystem.rotations?.[view]||0,c=Math.cos(r),s=Math.sin(r);return [origin[0]+(ox+scale*(c*x-s*z))/(111320*Math.cos(origin[1]*Math.PI/180)),origin[1]-(oz+scale*(s*x+c*z))/111320];}
export function adaptFactory(data){
    const fresh=t=>{const age=Date.now()-Date.parse(t);return Number.isFinite(age)&&age>=-5000&&age<=120000;};
    const collection=features=>({type:'FeatureCollection',features});
    const zones=data.entities.filter(e=>e.kind==='zone');
    const features=zones.map(z=>{const [x,y]=z.center,[w,h]=z.size;const ring=[[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2],[-w/2,-h/2]].map(([dx,dz])=>geoPoint(data,z.view,x+dx,y+dz));return {type:'Feature',properties:{zone_id:z.id,zone_type:z.title,risk_level:'高',buffer_radius:0,view:z.view},geometry:{type:'Polygon',coordinates:[ring]}};});
    const people=data.entities.filter(e=>e.kind==='person').map(e=>{const [lng,lat]=geoPoint(data,e.view,e.anchor[0],e.anchor[2]);return {...e,person_id:e.id,lng,lat,source:e.positionSource,timestamp:e.positionTimestamp,fresh:fresh(e.positionTimestamp)};});
    const results=people.map(e=>({person_id:e.id,risk_level:!e.fresh?'未知':e.riskState==='danger'?'高':'低',alert:e.currentZones?.length?`进入 ${e.currentZones.join('、')}`:'未进入限制区'}));
    const heatmap=zones.map(z=>({zone_id:z.id,zone_type:z.title,risk_level:'高',people_count:data.active.filter(a=>a.zoneId===z.id&&a.kind==='person'&&a.state!=='unknown').length,risk_score:data.active.some(a=>a.zoneId===z.id)?1:0}));
    const devices=data.entities.filter(e=>e.kind==='device').map(e=>({...e,factory:true,device_id:e.id,device_type:e.title,location:geoPoint(data,e.view,e.anchor[0],e.anchor[2]),source:e.measurementSource,timestamp:e.measurementTimestamp,status:fresh(e.measurementTimestamp)?'online':'stale',temperature:e.measurements?.temperature?.value,load:e.measurements?.load?.value,leakage:e.measurements?.leakage?.value,risk_score:e.riskState==='danger'?1:0,risk_level:e.riskState==='danger'?'高':'低',alert:e.riskState==='danger'?`进入 ${e.currentZones.join('、')}`:'演示测量，设备安全阈值待现场配置'}));
    return {zones:collection(features),buffers:collection([]),spatial:{revision:data.revision,people,results,heatmap},devices,snapshot_id:String(data.revision),updatedAt:data.updatedAt};
}
