import * as THREE from 'three';
import {pointInPolygon} from './gis-reference-geometry.mjs';

let textures;
function surfaces(){
 if(textures)return textures;
 if(typeof document==='undefined')return {metal:null,concrete:null,roof:null};
 // Procedural materials are bundled and deterministic, so the site works
 // offline and does not depend on a remote HDRI or a decorative photograph.
 let seed=731;const random=()=>{seed=(seed*16807)%2147483647;return seed/2147483647;};
 function texture(kind){const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const c=canvas.getContext('2d');c.fillStyle=kind==='metal'?'#c4c8c6':'#b7b9b6';c.fillRect(0,0,256,256);
  for(let i=0;i<6000;i++){const v=Math.floor(135+random()*90);c.fillStyle=`rgba(${v},${v},${v},${kind==='metal'?.18:.35})`;const x=random()*256,y=random()*256;c.fillRect(x,y,kind==='metal'?8+random()*40:1+random()*2,1);}
  if(kind==='roof'){c.fillStyle='#8f999b';for(let x=0;x<256;x+=32)c.fillRect(x,0,2,256);c.fillStyle='#d3d6d1';for(let x=2;x<256;x+=32)c.fillRect(x,0,1,256);}
  const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(kind==='roof'?.16:kind==='concrete'?.25:5,kind==='roof'?.16:kind==='concrete'?.25:5);t.anisotropy=4;return t;
 }
 textures={metal:texture('metal'),concrete:texture('concrete'),roof:texture('roof')};return textures;
}
export function finishInterior(root){
 const tex=surfaces(),cache=new Map();
 root.traverse(object=>{if(!object.isMesh)return;const enhance=m=>{if(!m?.isMeshStandardMaterial)return m;if(cache.has(m))return cache.get(m);const copy=m.clone();cache.set(m,copy);if(copy.metalness>.35){copy.roughness=Math.max(.28,Math.min(.52,copy.roughness));if(!copy.map)copy.map=tex.metal;}else if(copy.roughness>.72&&copy.color.r<.8&&Math.abs(copy.color.r-copy.color.g)<.18&&Math.abs(copy.color.g-copy.color.b)<.18&&!copy.map){copy.map=tex.concrete;copy.roughness=.86;}return copy;};object.material=Array.isArray(object.material)?object.material.map(enhance):enhance(object.material);});
 root.userData.materialFinish='procedural-industrial';return root;
}
export function finishExterior(root){
 const tex=surfaces(),detail=new THREE.Group();detail.name='industrial-envelope-detail';root.add(detail);
 const materials={steel:new THREE.MeshStandardMaterial({color:0x718086,roughness:.42,metalness:.7,map:tex.metal}),dark:new THREE.MeshStandardMaterial({color:0x35434a,roughness:.55,metalness:.55,map:tex.metal}),trim:new THREE.MeshStandardMaterial({color:0xd1a250,roughness:.56,metalness:.45}),glass:new THREE.MeshStandardMaterial({color:0x315266,roughness:.24,metalness:.38}),light:new THREE.MeshStandardMaterial({color:0xe5c584,emissive:0xb97827,emissiveIntensity:.65,roughness:.6})};
 const batches=new Map(),dummy=new THREE.Object3D(),geometry=new THREE.BoxGeometry(1,1,1);
 function box(pos,size,material,rotation=0){dummy.position.set(...pos);dummy.rotation.set(0,rotation,0);dummy.scale.set(...size);dummy.updateMatrix();if(!batches.has(material))batches.set(material,[]);batches.get(material).push(dummy.matrix.clone());}
 for(const b of root.userData.buildings){
  if(!b.mesh)continue;const points=b.points,h=b.height;
  const top=b.mesh.material[0],side=b.mesh.material[1];top.color.setHex(0x5a6b73);top.map=tex.roof;top.bumpMap=tex.roof;top.bumpScale=.055;top.roughness=.5;top.metalness=.46;side.color.setHex(0x68777d);side.map=tex.concrete;side.bumpMap=tex.concrete;side.bumpScale=.035;side.roughness=.86;
  // Every addition is aligned with the existing roof/wall footprint; no new
  // building, coordinate, height or process connection is asserted.
  const count=points.length,closed=points[0][0]===points.at(-1)[0]&&points[0][1]===points.at(-1)[1],end=closed?count-1:count;
  for(let i=0;i<end;i++){
   const [x,z]=points[i],[xx,zz]=points[(i+1)%end],dx=xx-x,dz=zz-z,length=Math.hypot(dx,dz);if(length<.5)continue;const angle=-Math.atan2(dz,dx);
   box([(x+xx)/2,.3,(z+zz)/2],[length,.5,.3],'dark',angle);
   box([(x+xx)/2,h-.35,(z+zz)/2],[length,.35,.22],'steel',angle);
   box([(x+xx)/2,h*.35,(z+zz)/2],[length,.14,.24],'steel',angle);
   for(let t=1;t<length-.6;t+=5.5){const px=x+dx*t/length,pz=z+dz*t/length;box([px,h/2,pz],[.19,h,.24],'dark',angle);
    if(t+3.6<length&&h>=4)box([x+dx*(t+2)/length,h*.64,z+dz*(t+2)/length],[3.3,h*.23,.3],'glass',angle);
    box([px,.75,pz],[.33,1.2,.34],'trim',angle);
    if(Math.floor(t/5.5)%2===0)box([px,h-.8,pz],[.6,.1,.34],'light',angle);
   }
  }
  const xs=points.map(p=>p[0]),zs=points.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
  // Lightweight standing seams stay inside the published roof polygon.
  for(let x=minX+1;x<maxX-1;x+=2.8)for(let z=minZ+1;z<maxZ-1;z+=8){const length=Math.min(7.7,maxZ-z-1);if(length<1||![[x-.05,z],[x+.05,z],[x-.05,z+length],[x+.05,z+length]].every(p=>pointInPolygon(p,points)))continue;box([x,h+.055,z+length/2],[.065,.07,length],'steel');}
  for(let x=minX+7;x<maxX-5;x+=18)for(let z=minZ+7;z<maxZ-5;z+=20){if(![[x-1,z-1],[x+1,z-1],[x+1,z+1],[x-1,z+1]].every(p=>pointInPolygon(p,points)))continue;
   box([x,h+.3,z],[1.75,.55,1.65],'steel');box([x,h+.59,z],[1.9,.07,1.8],'dark');for(let s=-.6;s<=.6;s+=.3)box([x+s,h+.64,z],[.07,.08,1.35],'steel');
   // Parallel short roof ducts, with restrained flange and support detail.
   if(pointInPolygon([x+3,z],points)){box([x+1.9,h+.18,z],[2,.21,.3],'steel');box([x+2.7,h+.12,z],[.13,.24,.65],'dark');}
  }
 }
 for(const [key,matrices] of batches){const mesh=new THREE.InstancedMesh(geometry,materials[key],matrices.length);matrices.forEach((matrix,i)=>mesh.setMatrixAt(i,matrix));mesh.instanceMatrix.needsUpdate=true;mesh.castShadow=key==='steel'||key==='dark';mesh.receiveShadow=true;mesh.name='envelope-'+key;detail.add(mesh);}
 root.userData.decorativeDetails={basis:'design-assumption',instances:[...batches.values()].reduce((n,items)=>n+items.length,0),batches:batches.size,footprintsPreserved:true};
 return root;
}

export function industrialEnvironment(renderer){
 const room=new THREE.Scene();room.background=new THREE.Color('#58676c');
 const geometry=new THREE.PlaneGeometry(30,12),white=new THREE.MeshBasicMaterial({color:0xd0e3e7,side:THREE.DoubleSide}),warm=new THREE.MeshBasicMaterial({color:0xefc995,side:THREE.DoubleSide});
 const overhead=new THREE.Mesh(geometry,white);overhead.position.set(0,20,0);overhead.rotation.x=Math.PI/2;room.add(overhead);
 const side=new THREE.Mesh(geometry,warm);side.position.set(-20,2,0);side.rotation.y=Math.PI/2;room.add(side);
 const opposite=new THREE.Mesh(geometry,white);opposite.position.set(10,2,-20);room.add(opposite);
 const generator=new THREE.PMREMGenerator(renderer),target=generator.fromScene(room,.08);generator.dispose();geometry.dispose();white.dispose();warm.dispose();return target;
}
