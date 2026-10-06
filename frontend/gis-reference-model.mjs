import * as THREE from 'three';
import {featurePoints,toLocal,clipSegment,pointInPolygon} from './gis-reference-geometry.mjs';
export function polygonMesh(points,height,color){const shape=new THREE.Shape(points.map(([x,z])=>new THREE.Vector2(x,-z)));const geometry=height?new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false}):new THREE.ShapeGeometry(shape);geometry.rotateX(-Math.PI/2);const materials=height?[new THREE.MeshStandardMaterial({color,roughness:.65,metalness:.2}),new THREE.MeshStandardMaterial({color:0xb4bfc0,roughness:.85})]:new THREE.MeshStandardMaterial({color,roughness:.92,side:THREE.DoubleSide});const mesh=new THREE.Mesh(geometry,materials);mesh.castShadow=!!height;mesh.receiveShadow=true;return mesh;}
export function buildReferenceExterior(site,layout){
 const root=new THREE.Group();root.name='reference-site-exterior';const buildings=[],pickables=[],markers=[];
 const mat=color=>new THREE.MeshStandardMaterial({color,roughness:.68,metalness:.15});
 function box(pos,size,color){const m=new THREE.Mesh(new THREE.BoxGeometry(...size),mat(color));m.position.set(...pos);m.castShadow=true;m.receiveShadow=true;root.add(m);return m;}
 const [west,south,east,north]=site.bounds,lo=toLocal(site,[west,north]),hi=toLocal(site,[east,south]),bounds=[lo[0],lo[1],hi[0],hi[1]];
 box([(lo[0]+hi[0])/2,-1.6,(lo[1]+hi[1])/2],[hi[0]-lo[0],2.5,hi[1]-lo[1]],0x263d43);
 const boundary=layout.features.find(f=>f.properties.kind==='boundary'),boundaryPoints=featurePoints(site,boundary);const ground=polygonMesh(boundaryPoints,0,0x909b91);ground.position.y=-.2;root.add(ground);
 function road(points,width,internal){for(let i=1;i<points.length;i++){const pair=clipSegment(points[i-1],points[i],bounds);if(!pair)continue;const [[x,z],[xx,zz]]=pair,dx=xx-x,dz=zz-z,length=Math.hypot(dx,dz);if(length<.1)continue;const m=box([(x+xx)/2,.02,(z+zz)/2],[length,.09,width],internal?0x626d70:0x414e53);m.rotation.y=-Math.atan2(dz,dx);if(!internal)for(let t=3;t<length-2;t+=7){const mark=box([x+dx*t/length,.09,z+dz*t/length],[2,.025,.13],0xdcdac5);mark.rotation.y=m.rotation.y;}}}
 for(const feature of layout.features){const props=feature.properties,points=featurePoints(site,feature);
  if(props.kind==='road')road(points,props.width||6,props.basis==='imagery-trace');
  if(props.kind==='yard'){const m=polygonMesh(points,0,0xad9d79);m.position.y=.045;root.add(m);}
  if(props.kind==='building'){
   const m=polygonMesh(points,props.height,props.id==='F-A'?0x466d7e:props.id==='F-B'?0x3c626f:0x8b9e9d);m.name=props.id;m.userData.info=props;root.add(m);pickables.push(m);buildings.push({id:props.id,points,height:props.height,mesh:m});
   const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(([x,z])=>new THREE.Vector3(x,props.height+.04,z))),new THREE.LineBasicMaterial({color:0xc5d2cf}));root.add(line);
   const xs=points.map(p=>p[0]),zs=points.map(p=>p[1]);for(let x=Math.min(...xs)+3;x<Math.max(...xs)-2;x+=7)for(let z=Math.min(...zs)+3;z<Math.max(...zs)-2;z+=10)if(pointInPolygon([x,z],points)&&pointInPolygon([x+1,z+2],points))box([x,props.height+.15,z],[1.5,.14,3],0x829b9b);
   const anchor=[points.slice(0,-1).reduce((s,p)=>s+p[0],0)/(points.length-1),props.height+1.3,points.slice(0,-1).reduce((s,p)=>s+p[1],0)/(points.length-1)];markers.push({...props,anchor});
  }
  if(props.kind==='gate'){const [x,z]=points[0];for(const dx of [-2.5,2.5])box([x+dx,1.5,z],[.3,3,.3],0xc7b279);box([x,2.8,z],[5,.2,.24],0xddb657);markers.push({...props,anchor:[x,4,z]});}
 }
 // Fence follows the actual published site boundary, not a decorative rectangle.
 for(let i=1;i<boundaryPoints.length;i++){const [x,z]=boundaryPoints[i-1],[xx,zz]=boundaryPoints[i],length=Math.hypot(xx-x,zz-z);const bar=box([(x+xx)/2,1.05,(z+zz)/2],[length,.07,.07],0xc8b278);bar.rotation.y=-Math.atan2(zz-z,xx-x);for(let t=0;t<length;t+=5)box([x+(xx-x)*t/length,1,z+(zz-z)*t/length],[.1,2,.1],0x6b8089);}
 root.userData={buildings,pickables,markers,bounds,boundaryPoints};return root;
}
