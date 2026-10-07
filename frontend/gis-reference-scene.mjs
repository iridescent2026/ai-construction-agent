import * as THREE from 'three';
import {OrbitControls} from './vendor/three/OrbitControls.js';
import {GLTFLoader} from './vendor/three/GLTFLoader.js';
import {buildFactorySite,updateFactorySite} from './factory-site-model.mjs';
import {layoutSectionLabels} from './factory-section-layout.mjs';

export class ReferenceScene{
 constructor(container,site,layout,onSelect){
  this.container=container;this.site=site;this.layout=layout;this.onSelect=onSelect;this.visible=true;this.cutaway=false;this.models=new Map();this.assets=new Map();this.labels=[];
  this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#203139');this.renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.2;this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.shadowMap.autoUpdate=false;container.replaceChildren(this.renderer.domElement);
  this.camera=new THREE.PerspectiveCamera(40,1,.1,1800);this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.maxPolarAngle=Math.PI*.48;this.controls.minDistance=40;this.controls.maxDistance=800;
  this.scene.add(new THREE.HemisphereLight(0xdaedf1,0x536261,2.5));const sun=new THREE.DirectionalLight(0xffedcf,3);sun.position.set(-80,150,65);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-140,right:140,top:140,bottom:-140,near:1,far:400});sun.shadow.normalBias=.12;this.scene.add(sun);
  this.labelLayer=document.createElement('div');this.labelLayer.className='section-area-labels';container.append(this.labelLayer);
  this.models.set(false,buildFactorySite(site,layout));this.setCutaway(false);this.resize();this.reset();this.loop();
  const loader=new GLTFLoader();this.ready=Promise.allSettled(['building-a.glb','building-k.glb','building-r.glb','tank.glb','pipe.glb','barrel.glb','pallet.glb','railing.glb','industrial-pipes.gltf','wall-vent.glb'].map(async name=>{const result=await loader.loadAsync('assets/factory/'+name);this.assets.set(name,result.scene);}));
  this.renderer.domElement.addEventListener('pointerdown',e=>{this.down=[e.clientX,e.clientY];});this.renderer.domElement.addEventListener('pointerup',e=>{
   if(!this.down||Math.hypot(e.clientX-this.down[0],e.clientY-this.down[1])>5)return;const r=this.renderer.domElement.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),this.camera);
   for(const hit of ray.intersectObject(this.root,true)){let node=hit.object,hidden=false;for(let p=node;p;p=p.parent)if(!p.visible)hidden=true;if(hidden)continue;while(node&&!node.userData.kind&&!node.userData.info)node=node.parent;const info=node?.userData.info||node?.userData;if(!info)continue;const current=this.data?.entities.find(e=>e.id===info.id);this.onSelect(current?{...current,workArea:current.view!=='overview'?current.view:null}:info);break;}
  });
 }
 setCutaway(value){
  this.cutaway=!!value;if(this.root)this.scene.remove(this.root);if(!this.models.has(this.cutaway))this.models.set(this.cutaway,buildFactorySite(this.site,this.layout,this.assets,{cutaway:this.cutaway}));
  this.root=this.models.get(this.cutaway);this.scene.add(this.root);this.container.dataset.siteView=this.cutaway?'section':'exterior';this.labelLayer.replaceChildren();this.labels=[];
  for(const area of this.root.userData.areaLabels){const label=document.createElement('div');label.className='section-area-label '+area.view;const strong=document.createElement('strong'),small=document.createElement('small');strong.textContent=area.title;small.textContent=area.note;label.append(strong,small);this.labelLayer.append(label);this.labels.push({node:label,anchor:area.anchor});}
  if(this.data)updateFactorySite(this.root,this.data,this.visibility);this.renderer.shadowMap.needsUpdate=true;if(this.camera)this.reset();
 }
 update(data,offline,visibility){this.data=data;this.visibility=visibility;if(this.cutaway)updateFactorySite(this.root,data,visibility);this.renderer.shadowMap.needsUpdate=true;}
 reset(){if(!this.root)return;const margin=this.cutaway?0:10,bounds=new THREE.Box3().setFromPoints(this.root.userData.boundaryPoints.flatMap(([x,z])=>[new THREE.Vector3(x-margin,0,z-margin),new THREE.Vector3(x+margin,15,z+margin)])),center=bounds.getCenter(new THREE.Vector3());center.y=3;const size=bounds.getSize(new THREE.Vector3()),distance=Math.max(size.x,size.z)*1.35/Math.min(1,this.camera.aspect);this.controls.target.copy(center);this.camera.position.copy(center).add(new THREE.Vector3(-distance*.63,distance*.95,distance*.40));this.controls.update();}
 resize(){const w=this.container.clientWidth,h=this.container.clientHeight;if(!w||!h)return;this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.reset();}
 setVisible(value){this.visible=value;if(value)this.resize();}
 locate(){/* Object detail remains available without adding spatial markers. */}
 loop(){if(this.disposed)return;this.frame=requestAnimationFrame(()=>this.loop());if(!this.visible)return;this.controls.update();this.renderer.render(this.scene,this.camera);layoutSectionLabels(this.labels,this.camera,this.container.clientWidth,this.container.clientHeight);}
 dispose(){this.disposed=true;cancelAnimationFrame(this.frame);this.controls.dispose();const geometries=new Set(),materials=new Set(),textures=new Set();for(const root of [this.scene,...this.models.values(),...this.assets.values()])root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of [].concat(o.material||[])){materials.add(m);for(const value of Object.values(m))if(value?.isTexture)textures.add(value);}if(o.isInstancedMesh)o.dispose();});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());this.renderer.dispose();this.container.replaceChildren();}
}
