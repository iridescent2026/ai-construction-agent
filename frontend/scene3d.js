import * as THREE from 'three';
import {OrbitControls} from './vendor/three/OrbitControls.js';
import {buildLandscape} from './site-landscape.js';

// Geographic footprints are real to the demo dataset. All vertical dimensions are illustrative.
export class SiteScene {
    constructor(container,onSelect) {
        this.container=container; this.onSelect=onSelect; this.visible=false; this.disposed=false;
        this.scene=new THREE.Scene(); this.scene.background=new THREE.Color('#0b1924');
        this.scene.add(buildLandscape());
        this.camera=new THREE.PerspectiveCamera(43,1,1,4000);
        this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1,2));
        this.renderer.outputColorSpace=THREE.SRGBColorSpace;
        container.appendChild(this.renderer.domElement);
        this.controls=new OrbitControls(this.camera,this.renderer.domElement);
        this.controls.enableDamping=true; this.controls.minDistance=100;this.controls.maxDistance=1300;
        this.controls.maxPolarAngle=Math.PI/2.1;
        this.scene.add(new THREE.HemisphereLight(0xffffff,0x496078,2.8));
        const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(-150,400,200);this.scene.add(sun);
        const ground=new THREE.Mesh(new THREE.PlaneGeometry(850,700),new THREE.MeshStandardMaterial({color:0x172b35,roughness:1}));
        ground.rotation.x=-Math.PI/2;ground.position.y=-1;this.scene.add(ground);
        this.grid=new THREE.GridHelper(850,34,0x355365,0x233d4a);this.grid.position.y=-.6;this.scene.add(this.grid);
        this.root=new THREE.Group();this.scene.add(this.root);this.pickable=[];
        this.raycaster=new THREE.Raycaster();this.pointer=new THREE.Vector2();
        this.down=null;
        this.onDown=e=>{this.down=[e.clientX,e.clientY];};
        this.onUp=e=>{
            if(!this.down || Math.hypot(e.clientX-this.down[0],e.clientY-this.down[1])>5)return;
            const rect=this.renderer.domElement.getBoundingClientRect();
            this.pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
            this.raycaster.setFromCamera(this.pointer,this.camera);
            const hit=this.raycaster.intersectObjects(this.pickable,false)[0];
            if(hit)this.onSelect(hit.object.userData);
        };
        this.renderer.domElement.addEventListener('pointerdown',this.onDown);
        this.renderer.domElement.addEventListener('pointerup',this.onUp);
        this.onLost=e=>{e.preventDefault();this.onSelect({title:'3D 显示已暂停',text:'图形上下文丢失，请切换二维视图，或刷新页面后重试。'});};
        this.renderer.domElement.addEventListener('webglcontextlost',this.onLost);
        this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);
        this.reset(); this.animate=this.animate.bind(this); this.frame=requestAnimationFrame(this.animate);
    }
    reset(){this.controls.target.set(0,0,0);this.camera.position.set(400,480,520);this.controls.update();}
    resize(){const w=this.container.clientWidth,h=this.container.clientHeight;if(!w||!h)return;this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h,false);}
    setVisible(value){this.visible=value;if(value)this.resize();}
    animate(){if(this.disposed)return;this.frame=requestAnimationFrame(this.animate);if(this.visible){this.controls.update();this.renderer.render(this.scene,this.camera);}}
    clear(){this.root.traverse(o=>{o.geometry?.dispose();if(o.material){for(const m of [].concat(o.material)){m.map?.dispose();m.dispose();}}});this.root.clear();this.pickable=[];}
    position(lng,lat){const [x,z]=window.SiteUI.localPoint(lng,lat);return [x,-z];}
    label(text,x,y,z){
        const canvas=document.createElement('canvas');canvas.width=256;canvas.height=64;
        const ctx=canvas.getContext('2d');ctx.fillStyle='#0c2230ed';ctx.fillRect(0,0,256,64);ctx.fillStyle='#40d3d0';ctx.fillRect(0,0,4,64);
        ctx.font='bold 28px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#def5f6';ctx.fillText(text,128,32);
        const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),depthTest:false}));
        sprite.scale.set(78,19.5,1);sprite.position.set(x,y,z);this.root.add(sprite);
    }
    outline(ring,color,y=0.8,dashed=false){
        const points=ring.map(([lng,lat])=>{const [x,z]=this.position(lng,lat);return new THREE.Vector3(x,y,z);});
        const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),dashed?new THREE.LineDashedMaterial({color,dashSize:5,gapSize:3}):new THREE.LineBasicMaterial({color}));
        line.computeLineDistances();this.root.add(line);
    }
    update(data){
        this.data=data;this.clear();const {colors,deviceState,personState}=window.SiteUI;
        for(const f of data.visibility?.zones===false?[]:(data.zones?.features || [])){
            const polygons=f.geometry.type==='MultiPolygon'?f.geometry.coordinates:[f.geometry.coordinates];
            for(const rings of polygons){
                const makePath=(ring,PathType)=>{const path=new PathType();ring.forEach(([lng,lat],i)=>{const [x,z]=this.position(lng,lat);i?path.lineTo(x,-z):path.moveTo(x,-z);});return path;};
                const shape=makePath(rings[0],THREE.Shape);for(const hole of rings.slice(1))shape.holes.push(makePath(hole,THREE.Path));
                const height=12; // Fixed illustrative extrusion; never presented as a measured building height.
                const geometry=new THREE.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false});geometry.rotateX(-Math.PI/2);
                const material=new THREE.MeshStandardMaterial({color:colors[f.properties.risk_level]||colors['未知'],transparent:true,opacity:0.48,depthWrite:false,side:THREE.DoubleSide});
                const mesh=new THREE.Mesh(geometry,material);mesh.userData={kind:'zone',id:f.properties.zone_id,title:`${f.properties.zone_id} ${f.properties.zone_type}`,text:`${f.properties.risk_level}风险区域；缓冲距离${f.properties.buffer_radius}米。立体高度12米仅为展示示意。`};this.root.add(mesh);this.pickable.push(mesh);
                this.outline(rings[0],colors[f.properties.risk_level]);
                const box=new THREE.Box3().setFromObject(mesh),center=box.getCenter(new THREE.Vector3());this.label(`${f.properties.zone_id} · ${f.properties.zone_type}`,center.x,28,center.z);
            }
        }
        for(const f of data.visibility?.buffers===false?[]:(data.buffers?.features || [])){
            const polygons=f.geometry.type==='MultiPolygon'?f.geometry.coordinates:[f.geometry.coordinates];
            for(const rings of polygons)for(const ring of rings)this.outline(ring,0x6d8195,0.6,true);
        }
        const results=new Map((data.spatial?.results||[]).map(r=>[r.person_id,r]));
        for(const p of data.visibility?.people===false?[]:(data.spatial?.people || [])){
            const status=personState(p,results.get(p.person_id));const [x,z]=this.position(p.lng,p.lat);
            const body=new THREE.Mesh(new THREE.CapsuleGeometry(3,7,4,8),new THREE.MeshStandardMaterial({color:status.color}));body.position.set(x,9,z);
            body.userData={kind:'person',id:p.person_id,title:p.person_id,text:`人员 · ${status.label}。采集：${p.timestamp}`};this.root.add(body);this.pickable.push(body);
            const helmet=new THREE.Mesh(new THREE.SphereGeometry(3.5,10,8),new THREE.MeshStandardMaterial({color:0xf4bd4e}));helmet.position.set(x,15,z);this.root.add(helmet);
            this.label(p.person_id,x,24,z);
        }
        for(const d of data.visibility?.devices===false?[]:(data.devices || [])){
            const state=deviceState(d);const [x,z]=this.position(...d.location);
            const box=new THREE.Mesh(new THREE.BoxGeometry(8,11,7),new THREE.MeshStandardMaterial({color:state.color,roughness:0.6}));box.position.set(x,5.5,z);
            box.userData={kind:'device',id:d.device_id,title:`${d.device_id} ${d.device_type}`,text:`${state.label} · ${d.alert}。负荷${d.load}% / 温度${d.temperature}℃ / 漏电${d.leakage}mA`};this.root.add(box);this.pickable.push(box);this.label(d.device_id,x,20,z);
        }
        if(data.visibility?.route!==false && data.route?.length>1)this.outline(data.route,0x735cdb,2,true);
        this.label('N ↑ 北',0,6,-320);
    }
    focus(lng,lat){const [x,z]=this.position(lng,lat);this.controls.target.set(x,0,z);this.camera.position.set(x+110,145,z+160);this.controls.update();}
    dispose(){this.disposed=true;cancelAnimationFrame(this.frame);this.resizeObserver.disconnect();this.controls.dispose();this.clear();this.scene.traverse(o=>{o.geometry?.dispose();if(o.material)for(const m of [].concat(o.material))m.dispose();});this.renderer.dispose();this.renderer.domElement.remove();}
}
