import * as THREE from 'three';
import {placeLabels} from './scene-layout.mjs';

// Use the same collision avoidance in both dashboards; only two area titles,
// never individual personnel or equipment markers, are shown in a cutaway.
export function layoutSectionLabels(labels,camera,width,height){
    const places=placeLabels(labels.map(({node,anchor,priority=1},i)=>{
        const p=new THREE.Vector3(...anchor).project(camera);
        return {id:String(i),x:(p.x+1)*width/2,y:(1-p.y)*height/2,width:node.offsetWidth,height:node.offsetHeight,priority,visible:p.z> -1&&p.z<1};
    }),width,height,65,45);
    labels.forEach(({node,anchor,outdoor},i)=>{let p=places.get(String(i));if(outdoor){const v=new THREE.Vector3(...anchor).project(camera),x=(v.x+1)*width/2,y=(1-v.y)*height/2;p=v.z>-1&&v.z<1&&x>=0&&x<=width&&y>=0&&y<=height?{x:x-node.offsetWidth/2,y:y-node.offsetHeight-4}:null;}node.hidden=!p;if(p){node.style.left=p.x+'px';node.style.top=p.y+'px';}});
}
