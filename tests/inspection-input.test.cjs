const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
const vendor=pathToFileURL(path.join(root,'frontend/vendor/three/three.module.js')).href;
const source=fs.readFileSync(path.join(root,'frontend/inspection-walk.mjs'),'utf8')
 .replace("from 'three'",`from '${vendor}'`)
 .replace("from './walk-math.mjs'",`from '${pathToFileURL(path.join(root,'frontend/walk-math.mjs')).href}'`);
const modulePromise=import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));

// Exercise the controller's public DOM events with real Three.js camera math.
class Node {
 constructor(){this.listeners=new Map();this.dataset={};this.classes=new Set();this.classList={add:(...v)=>v.forEach(x=>this.classes.add(x)),remove:(...v)=>v.forEach(x=>this.classes.delete(x)),toggle:(v,on)=>on?this.classes.add(v):this.classes.delete(v)};this.children=[];this.capture=new Set();}
 addEventListener(name,fn,options={}){const list=this.listeners.get(name)||[];list.push({fn,signal:options.signal});this.listeners.set(name,list);}
 fire(name,values={}){const e={target:this,preventDefault(){},...values};for(const {fn,signal} of this.listeners.get(name)||[])if(!signal?.aborted)fn(e);}
 append(node){this.children.push(node);}
 setAttribute(name,value){this[name]=value;}
 contains(node){return node===this||this.children.includes(node);}
 closest(){return null;}
 focus(){document.activeElement=this;}
 setPointerCapture(id){this.capture.add(id);}
 hasPointerCapture(id){return this.capture.has(id);}
 releasePointerCapture(id){this.capture.delete(id);}
 remove(){this.removed=true;}
 querySelector(key){return this.parts[key];}
 querySelectorAll(){return this.buttons;}
}
async function setup(t,options={}){
 const saved={window:global.window,document:global.document};
 const win=new Node(),doc=new Node();global.window=win;global.document=doc;
 win.matchMedia=()=>({matches:!options.touch});
 doc.createElement=()=>{const panel=new Node(),status=new Node(),exit=new Node();panel.parts={'.walk-status':status,'.walk-return':exit};panel.buttons=['w','a','s','d'].map(key=>{const b=new Node();b.dataset.walkKey=key;return b;});return panel;};
 const THREE=await import(vendor),{InspectionWalk}=await modulePromise;
 const camera=new THREE.PerspectiveCamera();camera.position.set(20,20,20);
 const canvas=new Node(),container=new Node(),controls={target:new THREE.Vector3(),enabled:true,update(){}};
 doc.pointerLockElement=null;doc.exitPointerLock=()=>{doc.pointerLockElement=null;doc.fire('pointerlockchange');};
 const lock=()=>{doc.pointerLockElement=canvas;doc.fire('pointerlockchange');return Promise.resolve();};
 canvas.requestPointerLock=options.deny?()=>Promise.reject(new Error('User gesture required')):lock;
 const walk=new InspectionWalk({camera,controls,renderer:{domElement:canvas},container,getInfo:()=>({id:'B-05',title:'循环排水泵组',anchor:[0,0,0]})});
 walk.obstacles=()=>{walk.bounds={minX:-10,maxX:10,minZ:-10,maxZ:10};walk.boxes=[];};
 t.after(()=>{walk.dispose();global.window=saved.window;global.document=saved.document;});
 walk.enter();await Promise.resolve();return {walk,camera,canvas,container,controls,win,doc,lock};
}
test('locked relative mouse input steers while walking and keeps turning at a screen edge',async t=>{
 const {walk,camera,canvas,win,doc}=await setup(t);const yaw=walk.yaw;
 win.fire('keydown',{target:canvas,key:'w'});
 doc.fire('mousemove',{buttons:0,clientX:999,clientY:999,movementX:100,movementY:50});
 assert.ok(walk.yaw<yaw&&walk.pitch<0);assert.equal(camera.rotation.y,walk.yaw);
 const p=camera.position.clone();walk.last=performance.now()-50;walk.update();
 const dx=camera.position.x-p.x,dz=camera.position.z-p.z;
 assert.ok(Math.hypot(dx,dz)>.1);assert.ok(Math.abs(dx/dz-Math.tan(walk.yaw))<1e-6);
 for(let i=0;i<40;i++)doc.fire('mousemove',{clientX:999,clientY:999,movementX:100,movementY:0});
 assert.ok(yaw-walk.yaw>Math.PI*2,'fixed client coordinates must not stop rotation');
 doc.fire('mousemove',{movementX:0,movementY:100000});assert.equal(walk.pitch,-1.25);
});
test('pointer leave does not stop locked turns; losing focus clears held movement',async t=>{
 const {walk,canvas,win,doc}=await setup(t);
 assert.doesNotThrow(()=>{win.fire('keydown');win.fire('keyup');});
 doc.fire('mousemove',{movementX:10,movementY:10});
 const yaw=walk.yaw;canvas.fire('pointerleave');canvas.fire('pointermove',{pointerType:'mouse',clientX:1200,clientY:900});assert.equal(walk.yaw,yaw);
 win.fire('keydown',{target:canvas,key:'w'});win.fire('blur');assert.equal(walk.keys.size,0);
 doc.fire('mousemove',{movementX:10,movementY:0});assert.ok(walk.yaw<yaw);
 const stopped=walk.yaw;
 walk.exit();doc.fire('mousemove',{movementX:100,movementY:0});assert.equal(walk.yaw,stopped);
});
test('locked relative mouse input does not double turn and Escape unlock restores the view',async t=>{
 const {walk,canvas,camera,container,controls,doc}=await setup(t);const saved=walk.saved.position.clone();
 assert.ok(container.classes.has('mouse-locked'));assert.equal(walk.lockPrompt.hidden,true);assert.equal(walk.reticle.hidden,false);
 const yaw=walk.yaw;canvas.fire('pointermove',{clientX:999,clientY:999,movementX:50,movementY:10});assert.equal(walk.yaw,yaw);
 doc.fire('mousemove',{movementX:50,movementY:10});assert.ok(Math.abs(walk.yaw-yaw+.15)<1e-10);
 // Browsers may consume Escape; loss of pointer lock must also exit.
 doc.exitPointerLock();assert.equal(walk.active,false);assert.equal(controls.enabled,true);assert.ok(camera.position.equals(saved));assert.ok(!container.classes.has('mouse-locked'));assert.equal(walk.reticle.hidden,true);
 walk.dispose();doc.fire('mousemove',{movementX:100,movementY:100});assert.equal(walk.active,false);
});
test('rejected pointer lock pauses desktop input until a successful user retry',async t=>{
 const {walk,camera,canvas,doc,win,lock}=await setup(t,{deny:true});
 assert.equal(walk.active,true);assert.equal(doc.pointerLockElement,null);assert.equal(walk.lockPrompt.hidden,false);
 const yaw=walk.yaw,p=camera.position.clone();canvas.fire('pointermove',{pointerType:'mouse',clientX:10,clientY:10});canvas.fire('pointermove',{pointerType:'mouse',clientX:900,clientY:900});assert.equal(walk.yaw,yaw);
 win.fire('keydown',{target:canvas,key:'w'});walk.last=performance.now()-50;walk.update();assert.ok(camera.position.equals(p));
 canvas.requestPointerLock=lock;walk.lockPrompt.onclick();assert.equal(walk.inputReady(),true);assert.equal(walk.lockPrompt.hidden,true);
});
test('touch inspection does not require mouse lock and retains drag and movement buttons',async t=>{
 const {walk,canvas,doc}=await setup(t,{touch:true});assert.equal(doc.pointerLockElement,null);assert.equal(walk.lockPrompt.hidden,true);
 const yaw=walk.yaw;canvas.fire('pointermove',{pointerType:'touch',clientX:10,clientY:10});assert.equal(walk.yaw,yaw);
 canvas.fire('pointerdown',{pointerType:'touch',pointerId:1,button:0,clientX:10,clientY:10});
 canvas.fire('pointermove',{pointerType:'touch',clientX:30,clientY:10});assert.ok(walk.yaw<yaw);
 walk.exit();assert.equal(canvas.hasPointerCapture(1),false);
 walk.enter();const button=walk.panel.buttons[0];button.fire('pointerdown',{pointerId:2});assert.ok(walk.keys.has('w'));button.fire('pointerup');assert.equal(walk.keys.size,0);
});
test('late lock grant after exit is released and stale rejections do not affect re-entry',async t=>{
 const {walk,canvas,doc}=await setup(t,{deny:true});let reject;
 canvas.requestPointerLock=()=>new Promise((_,failure)=>{reject=failure;});walk.requestLock();walk.exit();
 doc.pointerLockElement=canvas;doc.fire('pointerlockchange');assert.equal(doc.pointerLockElement,null);
 canvas.requestPointerLock=()=>{doc.pointerLockElement=canvas;doc.fire('pointerlockchange');return Promise.resolve();};walk.enter();
 reject(new Error('Old attempt'));await Promise.resolve();assert.equal(walk.inputReady(),true);assert.equal(walk.lockPrompt.hidden,true);
});
