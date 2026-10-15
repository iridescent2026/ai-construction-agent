import * as THREE from 'three';
const colors={yellow:0xe8b23d,steel:0x526575,dark:0x19242b,soil:0x90613f,glass:0x609bad,red:0xea4e35};
function kit(root){
 const materials=new Map();const mat=c=>{if(!materials.has(c))materials.set(c,new THREE.MeshStandardMaterial({color:c,roughness:.7,metalness:c===colors.soil?.02:.35}));return materials.get(c);};
 const add=(geo,c,x,y,z)=>{const m=new THREE.Mesh(geo,mat(c));m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;root.add(m);return m;};
 const box=(x,y,z,w,h,d,c)=>add(new THREE.BoxGeometry(w,h,d),c,x,y,z);
 const beam=(a,b,r,c)=>{const delta=new THREE.Vector3(...b).sub(new THREE.Vector3(...a)),m=add(new THREE.CylinderGeometry(r,r,delta.length(),8),c,...a);m.position.addScaledVector(delta,.5);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());return m;};
 return {box,beam,add};
}
export function constructionZone(info){
 const root=new THREE.Group();root.name='construction-'+info.id;const {box,beam,add}=kit(root),[w,d]=info.size;
 const earth=/土方|基坑|挖掘/.test(info.title);
 box(0,.07,0,w,.12,d,earth?colors.soil:0x4a5155);
 // Red/white low barriers leave the road-side entrance open.
 for(const side of [-1,1])for(let x=-w/2+1;x<w/2;x+=2.5){box(x,.65,side*d/2,2.1,1.15,.35,colors.red);box(x,.93,side*d/2,1.9,.23,.38,0xe4ddd0);}
 for(const side of [-1,1])for(let z=-d/2+1;z<d/2;z+=2.5){if(side===1&&Math.abs(z)<3)continue;box(side*w/2,.65,z,.35,1.15,2.1,colors.red);box(side*w/2,.93,z,.38,.23,1.9,0xe4ddd0);}
 if(earth){
  box(-w*.08,.16,0,w*.48,.16,d*.45,0x614936);
  for(let i=0;i<6;i++){const mound=add(new THREE.IcosahedronGeometry(1,1),colors.soil,-w*.36+i*w*.12,.65,d*.28);mound.scale.set(w*.075,1.3+(i%3)*.4,d*.1);}
  for(let i=0;i<8;i++)box(-w*.36+i*w*.09,.19,-d*.25,w*.028,.035,d*.45,0x6c4f38);
 }else{
  const craneStart=root.children.length;
  const span=w*.68,height=12,run=d*.62;
  for(const x of [-span/2,span/2]){for(const z of [-run/2,run/2]){box(x,height/2,z,.8,height,.8,colors.yellow);box(x,.45,z,2,.8,3,colors.steel);beam([x,height-3,z],[x+(x<0?2:-2),height,z],.15,colors.yellow);}box(x,height,0,.9,.8,run+2,colors.yellow);}
  box(0,height+.6,0,span+2,1,1.4,colors.yellow);box(2,height-.2,0,2.5,.6,2,colors.steel);beam([2,height,0],[2,5,0],.045,colors.dark);const hook=add(new THREE.TorusGeometry(.35,.09,8,18,Math.PI*1.5),colors.dark,2,4.8,0);hook.rotation.z=.3;const structure=new THREE.Group();structure.name='lifting-structure';for(const child of root.children.slice(craneStart))structure.add(child);root.add(structure);
  for(const side of [-1,1])box(side*w*.38,.2,0,.25,.2,d*.85,colors.steel);
  for(let row=0;row<3;row++)for(let i=0;i<4;i++)box(-w*.21+i*1.3,.45+row*.5,d*.2,1,.4,d*.26,colors.steel);
  for(let i=0;i<3;i++){box(w*.18+i*1.5,.4,-d*.22,.3,.6,d*.28,colors.yellow);}
 }
 root.userData.constructionKind=earth?'earthworks':'lifting';return root;
}
export function constructionDevice(info){
 const root=new THREE.Group(),{box,beam,add}=kit(root);root.name='machinery-'+info.id;
 if(/挖掘/.test(info.title)){
  for(const x of [-1.4,1.4]){box(x,.55,0,.8,1,4.5,colors.dark);for(let z=-1.8;z<2;z+=.6){const wheel=add(new THREE.CylinderGeometry(.34,.34,.86,10),colors.steel,x,.55,z);wheel.rotation.z=Math.PI/2;}}
  box(0,1.5,0,3,.8,3.5,colors.yellow);box(-.6,2.5,.1,1.5,1.7,1.8,colors.dark);box(-.6,2.7,1.03,1.25,1.1,.08,colors.glass);box(.85,2,-.8,1.2,.8,1.6,colors.yellow);
  beam([.7,2,1.2],[.7,5.1,3.5],.3,colors.yellow);beam([.7,5.1,3.5],[.7,1.9,6.1],.24,colors.yellow);beam([.7,2.3,1.4],[.7,4.7,2.9],.08,colors.steel);beam([.7,4.8,3.6],[.7,2.8,5.4],.07,colors.steel);box(.7,1.3,6.2,1.4,.8,1.5,colors.dark);
 }else if(/起重|吊/.test(info.title)){
  for(const x of [-14,14]){box(x,7.5,0,.8,15,1,colors.yellow);box(x,.5,0,2,1,5,colors.steel);beam([x,11,0],[x+(x<0?3:-3),15,0],.16,colors.yellow);}
  box(0,15,0,30,1,1.5,colors.yellow);box(2,14,0,3,.7,2,colors.steel);beam([2,14,0],[2,7,0],.045,colors.dark);const hook=add(new THREE.TorusGeometry(.35,.1,8,20,Math.PI*1.5),colors.dark,2,6.8,0);hook.rotation.z=.3;
 }else{
  box(0,1,0,2.8,.5,7,colors.steel);box(0,2,2.3,2.8,2.1,2.2,colors.yellow);box(0,2.4,3.44,2.3,.9,.06,colors.glass);box(0,1.9,-1.2,2.9,1.7,4.2,colors.steel);for(const x of [-1.55,1.55])for(const z of [-2,-.6,2.4]){const tire=add(new THREE.CylinderGeometry(.58,.58,.4,12),colors.dark,x,.65,z);tire.rotation.z=Math.PI/2;}
 }
 return root;
}
