import {buildFactory} from './factory-model.mjs';
import {buildReferenceExterior} from './gis-reference-model.mjs';
import {placeEntity} from './gis-reference-geometry.mjs';

// The homepage and remote-sensing workbench use exactly the same exterior and cutaway.
export function buildFactorySite(site,layout,assets=new Map(),{cutaway=false}={}){
    const root=buildReferenceExterior(site,layout,{cutaway});root.name=cutaway?'factory-site-cutaway':'factory-site-exterior';
    root.userData.workAreas=new Map();root.userData.areaLabels=[];
    if(cutaway)for(const view of ['a','b']){
        const frame=site.frames[view],model=buildFactory(view,assets);
        model.position.set(frame.translation[0],.06,frame.translation[1]);model.rotation.y=-frame.rotation;model.scale.setScalar(frame.scale);root.add(model);root.userData.workAreas.set(view,model);
        const point=placeEntity(site,view,view==='a'?-30:-34,-24);
        root.userData.areaLabels.push({view,title:view==='a'?'A · 装配制造':'B · 动力设备',anchor:[point[0],11,point[1]],note:view==='a'?'冲压 / 装配 / 机器人':'配电 / 换热 / 水处理'});
    }
    return root;
}

export function updateFactorySite(root,data,visibility={person:true,device:true,zone:true}){
    for(const [view,model] of root.userData.workAreas||[]){
        for(const info of [...model.userData.devices,...model.userData.people,...model.userData.zones]){
            const object=model.getObjectByName(info.id);if(!object)continue;object.visible=visibility[info.kind]!==false;
            const observed=data?.entities.find(e=>e.id===info.id);if(!observed)continue;
            if(info.kind==='person'||info.mobile){object.position.x=observed.anchor[0];object.position.z=observed.anchor[2];}
            if(info.kind==='zone'){const fill=object.children[0];fill.material.color.set(data.active?.some(a=>a.zoneId===info.id)?'#e76958':'#d77252');fill.material.opacity=.13;}
        }
    }
}
