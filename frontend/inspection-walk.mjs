import * as THREE from 'three';
import {stepWalk,freeObservationSpot} from './walk-math.mjs';
export class InspectionWalk{
 constructor({camera,controls,renderer,container,getRoot,getInfo,onExit}){Object.assign(this,{camera,controls,renderer,container,getRoot,getInfo,onExit});this.active=false;this.keys=new Set();this.last=performance.now();const panel=document.createElement('div');panel.className='walk-hud';panel.hidden=true;panel.innerHTML='<strong>巡检观察视角 · 设计模型</strong><p class="walk-status" role="status"></p><p>中央准星 · 鼠标无限转向 · W/A/S/D 移动<br>Esc 退出并释放鼠标 · 触屏拖动观察<br>相机位置不是现场人员位置，模型通道未现场核验。</p><div class="walk-touch"><button data-walk-key="w" aria-label="向前">↑</button><button data-walk-key="a" aria-label="向左">←</button><button data-walk-key="s" aria-label="向后">↓</button><button data-walk-key="d" aria-label="向右">→</button><button class="walk-return">退出巡视</button></div>';container.append(panel);this.panel=panel;panel.querySelector('.walk-return').onclick=()=>this.exit();
 this.reticle=document.createElement('div');this.reticle.className='walk-reticle';this.reticle.hidden=true;this.reticle.setAttribute('aria-hidden','true');container.append(this.reticle);
 this.lockPrompt=document.createElement('button');this.lockPrompt.className='walk-lock-prompt';this.lockPrompt.hidden=true;this.lockPrompt.textContent='点击锁定鼠标，开始连续巡视';this.lockPrompt.onclick=()=>this.requestLock();container.append(this.lockPrompt);
 const canvas=renderer.domElement;canvas.tabIndex=0;this.abort=new AbortController();const opts={signal:this.abort.signal};
 window.addEventListener('keydown',e=>{if(!this.active||typeof e.key!=='string')return;if(e.key==='Escape'){this.exit();return;}if(!this.inputReady())return;if(e.target.closest?.('input,textarea,select,dialog'))return;if(document.activeElement!==canvas&&!panel.contains(document.activeElement))return;const key=e.key.toLowerCase();if(['w','a','s','d','arrowup','arrowleft','arrowdown','arrowright'].includes(key)){e.preventDefault();this.keys.add(key);}},opts);
 window.addEventListener('keyup',e=>{if(typeof e.key==='string')this.keys.delete(e.key.toLowerCase());},opts);window.addEventListener('blur',()=>this.clearInput(),opts);document.addEventListener('visibilitychange',()=>this.clearInput(),opts);
 canvas.addEventListener('pointerdown',e=>{if(!this.active||e.button!==0)return;canvas.focus();if(e.pointerType&&e.pointerType!=='mouse'){this.requiresLock=false;this.lockPrompt.hidden=true;this.drag=[e.clientX,e.clientY];this.touchId=e.pointerId;canvas.setPointerCapture?.(e.pointerId);}},opts);
 canvas.addEventListener('pointermove',e=>{
  if(!this.active||document.pointerLockElement===canvas)return;
  const touch=e.pointerType&&e.pointerType!=='mouse',previous=this.drag;
  if(!touch||!previous)return;
  if(previous)this.look(e.clientX-previous[0],e.clientY-previous[1]);
  this.drag=[e.clientX,e.clientY];
 },opts);
 canvas.addEventListener('pointerleave',()=>{this.pointer=null;},opts);
 for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,()=>{this.drag=null;this.touchId=null;},opts);
 canvas.addEventListener('click',e=>{
  if(!this.active||(e.pointerType&&e.pointerType!=='mouse')||document.pointerLockElement===canvas)return;
  this.requiresLock=true;this.requestLock();
 },opts);
 document.addEventListener('mousemove',e=>{if(this.active&&document.pointerLockElement===canvas)this.look(e.movementX,e.movementY);},opts);
 document.addEventListener('pointerlockchange',()=>{
  const locked=document.pointerLockElement===canvas,wasLocked=this.locked;this.locked=locked;this.pointer=null;
  this.container.classList.toggle('mouse-locked',locked&&this.active);
  if(locked){this.pendingLock=false;this.lockPrompt.hidden=true;canvas.focus();}
  if(locked&&(!this.active||!this.requiresLock))document.exitPointerLock?.();else if(wasLocked&&!locked&&this.active&&this.requiresLock)this.exit();
 },opts);
 document.addEventListener('pointerlockerror',()=>this.lockFailed(),opts);
 panel.querySelectorAll('[data-walk-key]').forEach(b=>{b.addEventListener('pointerdown',e=>{e.preventDefault();if(!this.inputReady())return;b.setPointerCapture?.(e.pointerId);this.keys.add(b.dataset.walkKey);});for(const name of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(name,()=>this.keys.delete(b.dataset.walkKey));});
 }
 inputReady(){return this.active&&(!this.requiresLock||document.pointerLockElement===this.renderer.domElement);}
 requestLock(){
  if(!this.active||!this.requiresLock||this.pendingLock||document.pointerLockElement===this.renderer.domElement)return;
  const canvas=this.renderer.domElement,attempt=this.lockAttempt;
  if(!canvas.requestPointerLock){this.lockPrompt.hidden=false;this.lockPrompt.textContent='当前浏览器不支持鼠标锁定，请在 Edge / Chrome 打开';this.lockPrompt.disabled=true;return;}
  this.pendingLock=true;this.lockPrompt.hidden=false;this.lockPrompt.textContent='正在锁定鼠标…';
  try{canvas.requestPointerLock()?.catch(error=>{if(this.lockAttempt===attempt)this.lockFailed(error);});}catch(error){this.lockFailed(error);}
 }
 lockFailed(error){this.pendingLock=false;if(!this.active||!this.requiresLock||document.pointerLockElement===this.renderer.domElement)return;this.lockPrompt.hidden=false;this.lockPrompt.title=error?.message||'请将页面置于前台再点击；内置浏览器限制鼠标锁定时，请在 Edge / Chrome 打开本页。';this.lockPrompt.textContent=error?.name==='SecurityError'||error?.name==='NotSupportedError'?'此浏览器限制鼠标锁定，请用 Edge / Chrome 打开':'鼠标未锁定，点击此处继续巡视';}
 look(dx,dy){if(!Number.isFinite(dx)||!Number.isFinite(dy))return;this.yaw-=dx*.003;this.pitch=Math.max(-1.25,Math.min(1.25,this.pitch-dy*.003));this.orient();}
 clearInput(){this.keys.clear();this.pointer=null;this.drag=null;if(this.touchId!=null&&this.renderer.domElement.hasPointerCapture?.(this.touchId))this.renderer.domElement.releasePointerCapture(this.touchId);this.touchId=null;}
 obstacles(){const root=this.getRoot();root.updateWorldMatrix(true,true);const extent=new THREE.Box3().setFromObject(root);this.bounds={minX:extent.min.x+.7,maxX:extent.max.x-.7,minZ:extent.min.z+.7,maxZ:extent.max.z-.7};const boxes=[],matrix=new THREE.Matrix4(),world=new THREE.Matrix4();root.traverse(o=>{if(!o.isMesh)return;for(let p=o;p;p=p.parent)if(!p.visible||['zone','person'].includes(p.userData?.kind)||['zone','person'].includes(p.userData?.info?.kind))return;
 const materials=[].concat(o.material||[]);if(materials.every(m=>m.transparent&&m.opacity<.5))return;o.geometry.computeBoundingBox();const count=o.isInstancedMesh?o.count:1;
 for(let i=0;i<count;i++){if(o.isInstancedMesh){o.getMatrixAt(i,matrix);world.multiplyMatrices(o.matrixWorld,matrix);}else world.copy(o.matrixWorld);const b=o.geometry.boundingBox.clone().applyMatrix4(world);if(b.max.y<.35||b.min.y>1.8||b.max.y-b.min.y<.1)continue;boxes.push({minX:b.min.x,maxX:b.max.x,minZ:b.min.z,maxZ:b.max.z});}});this.boxes=boxes;}
 enter(info=this.getInfo()){if(this.active)this.exit();this.clearInput();this.obstacles();const target=info?.anchor||[0,0,0];const spot=freeObservationSpot([target[0],target[2]],this.bounds,this.boxes);if(!spot)throw new Error('此模型没有可用的观察点，请切换 A/B 工区');this.saved={position:this.camera.position.clone(),quaternion:this.camera.quaternion.clone(),target:this.controls.target.clone()};this.controls.enabled=false;this.camera.position.set(spot[0],1.65,spot[1]);this.yaw=Math.atan2(spot[0]-target[0],spot[1]-target[2]);this.pitch=0;this.active=true;this.targetInfo=info;this.last=performance.now();this.orient();this.panel.hidden=false;this.reticle.hidden=false;this.requiresLock=window.matchMedia?.('(hover: hover) and (pointer: fine)').matches??true;this.lockAttempt=(this.lockAttempt||0)+1;this.pendingLock=false;this.lockPrompt.disabled=false;this.lockPrompt.hidden=!this.requiresLock;this.lockPrompt.textContent='点击锁定鼠标，开始连续巡视';this.container.classList.add('walking');this.renderer.domElement.focus();this.status();if(this.requiresLock)this.requestLock();}
 orient(){this.camera.rotation.set(this.pitch,this.yaw,0,'YXZ');}
 status(){this.panel.querySelector('.walk-status').textContent=(this.targetInfo?this.targetInfo.id+' · '+this.targetInfo.title+' · ':'')+'观察点 x '+this.camera.position.x.toFixed(1)+' / z '+this.camera.position.z.toFixed(1)+' m';this.container.dataset.walkPosition=JSON.stringify([this.camera.position.x,this.camera.position.z]);}
 update(){if(!this.active)return;const now=performance.now(),dt=Math.min(.05,(now-this.last)/1000);this.last=now;if(!this.inputReady())return;let forward=(this.keys.has('w')||this.keys.has('arrowup')?1:0)-(this.keys.has('s')||this.keys.has('arrowdown')?1:0),right=(this.keys.has('d')||this.keys.has('arrowright')?1:0)-(this.keys.has('a')||this.keys.has('arrowleft')?1:0);const norm=Math.hypot(forward,right);if(norm){forward/=norm;right/=norm;const [x,z]=stepWalk([this.camera.position.x,this.camera.position.z],(-Math.sin(this.yaw)*forward+Math.cos(this.yaw)*right)*2.4*dt,(-Math.cos(this.yaw)*forward-Math.sin(this.yaw)*right)*2.4*dt,this.bounds,this.boxes);this.camera.position.set(x,1.65,z);this.status();}this.orient();}
 exit(){if(!this.active)return;this.active=false;this.lockAttempt++;this.pendingLock=false;this.clearInput();if(document.pointerLockElement===this.renderer.domElement)document.exitPointerLock?.();this.locked=false;this.panel.hidden=true;this.reticle.hidden=true;this.lockPrompt.hidden=true;this.container.classList.remove('walking','mouse-locked');this.camera.position.copy(this.saved.position);this.camera.quaternion.copy(this.saved.quaternion);this.controls.target.copy(this.saved.target);this.controls.enabled=true;this.controls.update();this.onExit?.();}
 dispose(){this.exit();this.abort.abort();this.panel.remove();this.reticle.remove();this.lockPrompt.remove();}
}
