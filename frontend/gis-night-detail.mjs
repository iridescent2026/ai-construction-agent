import * as THREE from 'three';
import {pointInPolygon} from './gis-reference-geometry.mjs';

// Architectural visualization details; the published footprint stays authoritative.
export function detailIndustrialExterior(root){
 const group=new THREE.Group();group.name='industrial-architectural-detail';root.add(group);
 const material=(color,metalness=.2,roughness=.65,emissive=0,intensity=0)=>new THREE.MeshStandardMaterial({color,metalness,roughness,emissive,emissiveIntensity:intensity});
 const steel=material('#253640',.75,.38),trim=material('#b7b6a5',.65,.4),gold=material('#b28c39',.65,.4),glass=material('#293d48',.5,.22,'#ffb848',.65),light=material('#ffdf9a',.1,.3,'#ffc570',3),leaf=material('#233f35',.05,.95),trunk=material('#4b4132'),dock=material('#333f45',.5,.65);
 const cube=new THREE.BoxGeometry(1,1,1),sphere=new THREE.IcosahedronGeometry(1,1),cylinder=new THREE.CylinderGeometry(1,1,1,10);
 function box(parent,x,y,z,w,h,d,mat,angle=0){const m=new THREE.Mesh(cube,mat);m.position.set(x,y,z);m.scale.set(w,h,d);m.rotation.y=angle;m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
 function pipe(x,y,z,length,radius,angle=0){const m=new THREE.Mesh(cylinder,steel);m.scale.set(radius,length,radius);m.rotation.z=Math.PI/2;m.rotation.y=angle;m.position.set(x,y,z);group.add(m);return m;}
 const buildings=root.userData.buildings||[];
 for(const building of buildings){if(!building.mesh)continue;const points=building.points,roof=building.height||10;
  if(Array.isArray(building.mesh.material)){building.mesh.material[0].color.set('#344751');building.mesh.material[0].metalness=.7;building.mesh.material[0].roughness=.42;building.mesh.material[1].color.set('#586268');}
  for(let i=1;i<points.length;i++){
   const [x,z]=points[i-1],[xx,zz]=points[i],dx=xx-x,dz=zz-z,len=Math.hypot(dx,dz);if(len<2)continue;const angle=-Math.atan2(dz,dx),cx=(x+xx)/2,cz=(z+zz)/2;
   const edge=new THREE.Group();edge.position.set(cx,0,cz);edge.rotation.y=angle;group.add(edge);
   box(edge,0,roof-.12,0,len,.22,.3,trim);box(edge,0,roof-.55,0,len,.12,.18,light);box(edge,0,.45,0,len,.5,.5,steel);
   const count=Math.max(1,Math.floor(len/4));for(let j=0;j<=count;j++){
    const at=-len/2+j*len/count;box(edge,at,roof/2,0,.2,roof,.32,gold);
    if(j<count){const mid=at+len/count/2;box(edge,mid,roof*.49,.03,len/count-.38,roof*.68,.12,glass);box(edge,mid,roof*.47,-.09,len/count,.1,.3,steel);box(edge,mid,roof*.72,-.09,len/count,.1,.3,steel);box(edge,mid,roof*.24,-.09,len/count,.13,.3,steel);}
   }
   // The far side receives loading bays and a clear service apron.
   if(i===1&&len>12){for(let j=0;j<Math.floor(len/14);j++){const at=-len/2+7+j*14;box(edge,at,2,-.28,3.8,3.7,.3,dock);for(let k=0;k<7;k++)box(edge,at,.6+k*.45,-.49,3.7,.04,.04,trim);box(edge,at,4,-1.3,5,.16,2.7,steel);box(edge,at-.2,.2,-3,4,.3,3,dock);}}
   for(let at=-len/2+4;at<len/2;at+=9)box(edge,at,roof+.12,0,.18,.24,1.5,trim);
  }
  const xs=points.map(p=>p[0]),zs=points.map(p=>p[1]),minx=Math.min(...xs),maxx=Math.max(...xs),minz=Math.min(...zs),maxz=Math.max(...zs);
  for(let x=minx+1;x<maxx;x+=2.6){let run=null;for(let z=minz+.6;z<=maxz;z+=.8){const inside=pointInPolygon([x,z],points);if(inside&&run===null)run=z;if((!inside||z+.8>maxz)&&run!==null){const end=z-.8;if(end>run)box(group,x,roof+.08,(run+end)/2,.07,.12,end-run,trim);run=null;}}}
  const id=building.id==='F-A'?'A':building.id==='F-B'?'B':null;if(id){const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d');ctx.fillStyle='#e8e7db';ctx.font='bold 190px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(id,128,136);const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;const label=new THREE.Mesh(new THREE.PlaneGeometry(7,7),new THREE.MeshStandardMaterial({map:texture,transparent:true,depthWrite:false,roughness:.9}));label.rotation.x=-Math.PI/2;label.position.set((minx+maxx)/2,roof+.3,(minz+maxz)/2);group.add(label);}
 }
 const boundary=root.userData.boundaryPoints,center=boundary.reduce((a,p)=>[a[0]+p[0]/boundary.length,a[1]+p[1]/boundary.length],[0,0]);let lightCount=0;
 for(let i=1;i<boundary.length;i++){const p=boundary[i-1],q=boundary[i],len=Math.hypot(q[0]-p[0],q[1]-p[1]);for(let t=4;t<len;t+=8){const x=p[0]+(q[0]-p[0])*t/len,z=p[1]+(q[1]-p[1])*t/len,dx=x-center[0],dz=z-center[1],norm=Math.hypot(dx,dz)||1,tx=x+dx/norm*3,tz=z+dz/norm*3;
   box(group,tx,1.7,tz,.35,3.4,.35,trunk);for(let k=0;k<3;k++){const crown=new THREE.Mesh(sphere,leaf);crown.position.set(tx+(k-1)*.7,3.4+k*.6,tz);crown.scale.set(2.1,2.5,2);crown.castShadow=true;group.add(crown);}
   if(t%24<8){box(group,x,3.4,z,.14,6.8,.14,steel);box(group,x,6.8,z,1.2,.2,.5,light);if(lightCount++<6){const bulb=new THREE.PointLight('#ffc36b',90,20,2);bulb.position.set(x,6.4,z);group.add(bulb);}}
  }}
 // Pipe service rack along an open boundary segment; avoid building footprints.
 if(boundary.length>1){const p=boundary[0],q=boundary[1],length=Math.hypot(q[0]-p[0],q[1]-p[1]),angle=-Math.atan2(q[1]-p[1],q[0]-p[0]);for(let i=0;i<3;i++)pipe((p[0]+q[0])/2,1+i*.5,(p[1]+q[1])/2,length,.2,angle);}
 root.userData.visualization='Architectural night concept; additional facade and service details are designed, not surveyed.';
 return group;
}
