import * as THREE from 'three';
import {FOOTPRINTS} from './factory-footprints.mjs';

export const VIEWS={
    overview:{title:'厂区三维外观',subtitle:'与厂区平面共用轮廓 · 纯建筑外观',camera:[125,195,145],target:[0,7,0]},
    a:{title:'局部 A · 自动化装配车间',subtitle:'高跨钢结构 · 工业机器人 · 输送装配线',camera:[66,47,64],target:[0,4,0]},
    b:{title:'局部 B · 综合动力设备工区',subtitle:'成套配电 · 备用发电 · 换热与水处理 · 泵阀管廊',camera:[92,91,99],target:[5,3,0]}
};
const C={steel:0x637984,metal:0x9eafb3,wall:0xc1c7c2,concrete:0x838f90,blue:0x355a6b,dark:0x202e36,gold:0xe8ac42,red:0xb34d3e,green:0x417b69,glass:0x567f8c,earth:0x896b4f};

// Scene coordinates are design metres; they are not GIS observations.
export const ZONES=[
    {id:'Z001',view:'overview',title:'土方施工区',center:[-18,27],size:[36,26],text:'挖掘机作业与土方施工范围；人员经外围通道通行。',devices:['E-01','E-02']},
    {id:'Z002',view:'overview',title:'吊装作业区',center:[28,6],size:[32,26],text:'钢架吊运与材料装配范围；吊运时隔离下方作业面。',devices:['E-05']},
    {id:'Z003',view:'a',title:'冲压加工危险区',center:[-14,-9],size:[20,8],text:'冲压运动夹点与加工旋转部件区域。',devices:['A-01','A-02']},
    {id:'Z004',view:'a',title:'储气焊接危险区',center:[14,-8],size:[24,8],text:'压力容器与焊接工作站作业范围，关注压力和动火隔离。',devices:['A-03','A-04']},
    {id:'Z005',view:'b',title:'高压隔离区',center:[-19,-21],size:[47,19],text:'高压开关与变压器设备范围；授权人员按作业规程进入。',devices:['B-01','B-02']},
    {id:'Z006',view:'b',title:'阀门操作区',center:[19,-21],size:[22,18],text:'工艺介质阀门与仪表操作范围，关注介质压力及泄漏。',devices:['B-03']},
    {id:'Z007',view:'b',title:'泵组压力区',center:[3.5,17],size:[44,16],text:'循环泵与压力稳压装置范围，关注振动和压力。',devices:['B-05','B-06']},
    {id:'Z009',view:'b',title:'备用发电隔离区',center:[-32,-7],size:[22,9],text:'备用发电机的高温、转动与燃油作业隔离范围。',devices:['B-09']},
    {id:'Z010',view:'b',title:'换热压缩机作业区',center:[5,-7],size:[44,9],text:'换热机组与压缩机的压力、高温和传动防护范围。',devices:['B-08','B-10']},
    {id:'Z011',view:'b',title:'水处理维护区',center:[34,16],size:[16,16],text:'过滤器、加药和水处理设备维护范围。',devices:['B-11']},
    {id:'Z012',view:'b',title:'UPS 蓄电池维护区',center:[54,-2],size:[14,7],text:'UPS 电源和电池柜的带电维护、直流短路隔离范围。',devices:['B-12']},
    {id:'Z008',view:'a',title:'机器人自动运行区',center:[-1,-17],size:[40,8],text:'自动化装配单元，关注机械臂运动、输送夹点与防护联锁。',devices:['A-10','A-11','A-12']}
];

export const PERSONNEL=[
    ['P001','a','安全员',-6,.7],['P003','a','机械操作工',-23.5,-7],['P004','a','电工',-19,.3],['P005','a','装配工',-12,-.6],['P006','a','设备维修工',0,-.7],['P007','a','装配工',5,.6],['P008','a','工艺工程师',12,-.6],['P009','a','物流工',18,.6],['P010','a','焊工',23.8,-5],['P011','a','施工工人',-12,5],['P012','a','设备操作工',9,5],['P013','a','装配工',-1,13],
    ['P002','b','设备维修工',-12,.7],['P014','b','电工',-36,-15],['P015','b','安全员',-35,0],['P016','b','电工',-2,-.6],['P017','b','管道工',20,.6],['P018','b','泵房操作工',22,18],['P019','b','工艺工程师',43,6],['P020','b','巡检人员',60,15],
    ['P021','overview','门岗人员',12,47],['P022','overview','施工工人',-20,22],['P023','overview','施工工人',-41,12],['P024','overview','吊装工',35,4],['P025','overview','电工',60,43],['P026','overview','工程车司机',8,39]
].map(([id,view,role,x,z])=>({id,view,role,x,z}));

export function buildFactory(view='overview',assets=new Map()) {
    if(!VIEWS[view])throw new Error('Unknown factory view');
    const root=new THREE.Group();root.name='factory-'+view;
    const devices=[],people=[],zones=[],batches=new Map(),materials=new Map(),unitBox=new THREE.BoxGeometry(1,1,1),unitCylinder=new THREE.CylinderGeometry(1,1,1,20),unitRing=new THREE.TorusGeometry(1,.055,6,20),dummy=new THREE.Object3D();
    const material=color=>{if(!materials.has(color))materials.set(color,new THREE.MeshStandardMaterial({color,roughness:color===C.steel||color===C.metal?.38:.8,metalness:color===C.steel||color===C.metal?.65:.08}));return materials.get(color);};
    function group(parent,name){const g=new THREE.Group();g.name=name;parent.add(g);return g;}
    function batch(g,color,type){const key=g.uuid+':'+color+':'+type;if(!batches.has(key))batches.set(key,{g,color,type,matrices:[]});return batches.get(key).matrices;}
    function box(g,x,y,z,w,h,d,color,rx=0,ry=0,rz=0){dummy.position.set(x,y,z);dummy.rotation.set(rx,ry,rz);dummy.scale.set(w,h,d);dummy.updateMatrix();batch(g,color,'box').push(dummy.matrix.clone());}
    function cyl(g,x,y,z,r,h,color,rx=0,rz=0){dummy.position.set(x,y,z);dummy.rotation.set(rx,0,rz);dummy.scale.set(r,h,r);dummy.updateMatrix();batch(g,color,'cylinder').push(dummy.matrix.clone());}
    function beam(g,a,b,r,color){const p=new THREE.Vector3(...a),q=new THREE.Vector3(...b),v=q.clone().sub(p);dummy.position.copy(p.add(q).multiplyScalar(.5));dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),v.clone().normalize());dummy.scale.set(r,v.length(),r);dummy.updateMatrix();batch(g,color,'cylinder').push(dummy.matrix.clone());}
    function ring(g,x,y,z,r,color,rx=0,ry=0){dummy.position.set(x,y,z);dummy.rotation.set(rx,ry,0);dummy.scale.setScalar(r);dummy.updateMatrix();batch(g,color,'ring').push(dummy.matrix.clone());}
    function mesh(g,geometry,color,pos){const m=new THREE.Mesh(geometry,material(color));m.position.set(...pos);m.castShadow=true;m.receiveShadow=true;g.add(m);return m;}
    function workShell(view){
        const ring=FOOTPRINTS[view],shape=new THREE.Shape(ring.map(([x,z])=>new THREE.Vector2(x,-z)));
        const floorGeometry=new THREE.ExtrudeGeometry(shape,{depth:.7,bevelEnabled:false});floorGeometry.rotateX(-Math.PI/2);
        const shell=group(root,view==='a'?'assembly-steel-shell':'basement-concrete-shell');
        mesh(shell,floorGeometry,view==='a'?C.concrete:0x697b83,[0,-.7,0]);
        for(let i=1;i<ring.length;i++){
            const [x,z]=ring[i-1],[xx,zz]=ring[i],length=Math.hypot(xx-x,zz-z),rear=(z+zz)/2<0,wallHeight=rear?(view==='a'?10:7.2):.55;
            box(shell,(x+xx)/2,wallHeight/2,(z+zz)/2,length,wallHeight,.55,view==='a'?C.wall:0x95a4a2,0,-Math.atan2(zz-z,xx-x));
            if(rear)for(let t=4;t<length-2;t+=12)box(shell,x+(xx-x)*t/length,wallHeight/2,z+(zz-z)*t/length,.65,wallHeight,.65,view==='a'?C.steel:C.concrete);
        }
        root.userData.footprint=ring.map(p=>[...p]);
    }
    function imported(g,name,pos,size,rotation=0,axisRadius=0){
        const original=name.startsWith('industrial-pipes#')?assets.get('industrial-pipes.gltf')?.getObjectByName('modular_industrial_pipes_01_'+name.split('#')[1]):assets.get(name);if(!original)return false;
        const object=original.clone(true);if(name.startsWith('industrial-pipes#'))object.position.set(0,0,0);
        if(name==='pipe.glb'||name.startsWith('industrial-pipes#')){const initial=new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());if(initial.y>initial.x&&initial.y>initial.z)object.rotateZ(Math.PI/2);else if(initial.z>initial.x)object.rotateY(Math.PI/2);}
        const bounds=new THREE.Box3().setFromObject(object),s=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
        const holder=group(g,'asset-'+name);holder.add(object);
        if(axisRadius){
            // The source valve ports lie on its origin axis. Align the ports,
            // rather than the asymmetric handwheel's bounding-box centre.
            let radius=0;const p=new THREE.Vector3(),positions=object.geometry.attributes.position;
            for(let i=0;i<positions.count;i++){p.fromBufferAttribute(positions,i).applyQuaternion(object.quaternion);if(Math.abs(p.x-bounds.min.x)<.0001||Math.abs(p.x-bounds.max.x)<.0001)radius=Math.max(radius,Math.hypot(p.y,p.z));}
            object.position.set(0,0,0);holder.scale.set(size[0]/s.x,axisRadius/radius,axisRadius/radius);
        }else{object.position.set(-center.x,-bounds.min.y,-center.z);holder.scale.set(size[0]/s.x,size[1]/s.y,size[2]/s.z);}
        holder.position.set(...pos);holder.rotation.y=rotation;
        object.traverse(m=>{if(!m.isMesh)return;m.castShadow=true;m.receiveShadow=true;
            m.material=[].concat(m.material).map(old=>{const mat=new THREE.MeshStandardMaterial({color:old.color||C.metal,map:old.map||null,normalMap:old.normalMap||null,roughnessMap:old.roughnessMap||null,metalnessMap:old.metalnessMap||null,roughness:.65,metalness:name.startsWith('industrial-pipes#')?.8:.25});return mat;});if(m.material.length===1)m.material=m.material[0];});
        return true;
    }
    function hazard(g,x,z,w,d){
        box(g,x,.045,z,w,.06,d,C.dark);
        for(let dx=-w/2;dx<w/2;dx+=.9)for(const edge of [-1,1])box(g,x+dx,.09,z+edge*(d/2-.12),.45,.025,.22,C.gold,0,0,0);
        for(let dz=-d/2;dz<d/2;dz+=.9)for(const edge of [-1,1])box(g,x+edge*(w/2-.12),.09,z+dz,.22,.025,.45,C.gold);
    }
    function person(g,x,z,angle=0){
        const p=group(g,'巡检人员');p.position.set(x,0,z);p.rotation.y=angle;
        for(const dx of [-.16,.16]){box(p,dx,.48,0,.23,.8,.28,C.blue);box(p,dx,.12,.08,.26,.18,.4,C.dark);}
        box(p,0,1.12,0,.66,.65,.38,C.gold);box(p,0,1.02,.205,.68,.075,.035,0xe2e5cb);
        for(const dx of [-.4,.4])box(p,dx,1.1,0,.2,.65,.25,C.gold,0,0,dx*.25);
        mesh(p,new THREE.SphereGeometry(.2,12,10),0xbc957b,[0,1.65,0]);
        mesh(p,new THREE.SphereGeometry(.25,16,10,0,Math.PI*2,0,Math.PI/2),C.gold,[0,1.73,0]);cyl(p,0,1.73,0,.29,.06,C.gold);
        return p;
    }
    function registerPerson(p,def){
        p.name=def.id;p.scale.setScalar(view==='overview'?1.3:1.15);p.userData={id:def.id,kind:'person',view,title:def.role,role:def.role,origin:[def.x,def.z],anchor:[def.x,view==='overview'?3.1:2.7,def.z],text:`岗位：${def.role} · 本地模拟位置，进入危险区域时触发空间报警。`};people.push(p.userData);
    }
    function registerEquipment(g,id,title,anchor,mobile=false,allowedZones=[]){
        g.name=id;g.userData={id,kind:'device',view,title,anchor,mobile,allowedZones,origin:[g.position.x,g.position.z],text:mobile?'巡检关注：车辆行驶范围与人员隔离 · 本地模拟位置':'巡检关注：设备运行与作业隔离 · 场景设计示意'};devices.push(g.userData);return g;
    }
    function markZone(def){
        const [x,z]=def.center,[w,d]=def.size,y=view==='overview'?.23:.11;
        const g=group(root,def.id);g.userData={...def,kind:'zone',anchor:[x-w/2+.9,.7,z+d/2-.9],text:`${def.text} · 危险范围为设计标注，非实时风险判定。`};zones.push(g.userData);
        const fill=new THREE.Mesh(new THREE.PlaneGeometry(w,d),new THREE.MeshBasicMaterial({color:0xd77252,transparent:true,opacity:.17,depthWrite:false,side:THREE.DoubleSide}));fill.rotation.x=-Math.PI/2;fill.position.set(x,y,z);g.add(fill);
        const points=[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2],[-w/2,-d/2]].map(([dx,dz])=>new THREE.Vector3(x+dx,y+.02,z+dz));g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:0xf18e65})));
    }
    function rail(g,x,y,z,w){
        if(imported(g,'railing.glb',[x,y,z],[w,1.1,.16]))return;
        for(const dx of [-w/2,w/2])box(g,x+dx,y+.55,z,.06,1.1,.06,C.gold);for(const h of [.5,1.1])box(g,x,y+h,z,w,.06,.06,C.gold);
    }
    function pipe(g,points,r=.14,color=C.metal){
        for(let i=1;i<points.length;i++)beam(g,points[i-1],points[i],r,color);
        for(const p of points.slice(1,-1))mesh(g,new THREE.SphereGeometry(r,12,10),color,p);
    }
    function valve(g,x,y,z){
        cyl(g,x,y,z,.3,.32,C.blue,Math.PI/2);box(g,x,y+.35,z,.07,.55,.07,C.steel);
        const wheel=mesh(g,new THREE.TorusGeometry(.34,.035,6,24),C.red,[x,y+.64,z]);wheel.rotation.x=Math.PI/2;
        for(const a of [0,Math.PI/2])box(g,x,y+.64,z,.64,.04,.04,C.red,0,a);
    }
    function flange(g,p,direction,r=.38){
        const axis=new THREE.Vector3(...direction).normalize();beam(g,new THREE.Vector3(...p).addScaledVector(axis,-.08).toArray(),new THREE.Vector3(...p).addScaledVector(axis,.08).toArray(),r,C.metal);
        const u=new THREE.Vector3(0,1,0);if(Math.abs(axis.y)>.9)u.set(1,0,0);u.cross(axis).normalize();const v=axis.clone().cross(u);
        for(let i=0;i<8;i++){const q=new THREE.Vector3(...p).addScaledVector(u,Math.cos(i*Math.PI/4)*r*.76).addScaledVector(v,Math.sin(i*Math.PI/4)*r*.76);beam(g,q.clone().addScaledVector(axis,-.13).toArray(),q.clone().addScaledVector(axis,.13).toArray(),.045,C.dark);}
    }
    function powerPipe(g,points,r=.22,color=C.metal){
        pipe(g,points,r,color);for(let i=1;i<points.length;i++){const a=new THREE.Vector3(...points[i-1]),b=new THREE.Vector3(...points[i]),direction=b.clone().sub(a).normalize(),length=a.distanceTo(b);if(length<.65)continue;for(const p of [a.addScaledVector(direction,.3),b.addScaledVector(direction,-.3)])flange(g,p.toArray(),direction.toArray(),r*1.7);}
    }
    function post(g,x,z,top,width=.2,bottom=0){
        box(g,x,bottom+.07,z,width*3,.14,width*3,C.steel);box(g,x,(top+bottom+.14)/2,z,width,top-bottom-.14,width,C.steel);
        for(const dx of [-width,width])for(const dz of [-width,width])cyl(g,x+dx,bottom+.15,z+dz,.04,.1,C.metal);
    }
    function pipeCap(g,p,axis,r=.22){flange(g,p,axis,r*1.7);const v=new THREE.Vector3(...axis).normalize(),q=new THREE.Vector3(...p);beam(g,q.clone().addScaledVector(v,-.055).toArray(),q.clone().addScaledVector(v,.055).toArray(),r*1.32,C.steel);}
    function gaugeStem(g,x,y,z,pipeY,pipeZ){powerPipe(g,[[x,pipeY,pipeZ],[x,y-.16,pipeZ],[x,y-.16,z],[x,y,z]],.055);}
    function dial(g,x,y,z,r=.28){
        const face=mesh(g,new THREE.CylinderGeometry(r,r,.065,24),0xe8e3cd,[x,y,z]);face.rotation.x=Math.PI/2;mesh(g,new THREE.TorusGeometry(r,.025,6,24),C.dark,[x,y,z+.045]);
        for(let i=0;i<10;i++){const a=i*Math.PI/5;box(g,x+Math.sin(a)*r*.8,y+Math.cos(a)*r*.8,z+.05,.026,r*.18,.022,C.dark,0,0,-a);}
        box(g,x+.06,y+.06,z+.07,.027,r*1.4,.028,C.red,0,0,-.55);
    }
    function motor(g,x,y,z,length=2.8,direction=1){
        cyl(g,x,y,z,.62,length,C.blue,Math.PI/2);for(let dz=-length/2;dz<=length/2;dz+=.23)ring(g,x,y,z+dz,.63,C.steel);
        box(g,x,y+.75,z,.9,.48,.8,C.blue);for(const dx of [-.55,.55])box(g,x+dx,(y-.55+.36)/2,z,.25,y-.55-.36,length*.8,C.steel);
        const coupling=z+direction*(length/2+(direction<0?.4:.22));cyl(g,x,y,coupling,.27,direction<0?.9:.4,C.metal,Math.PI/2);box(g,x,y,coupling,.8,.85,direction<0?.95:.5,C.gold);
    }
    function powerPanel(g,x,z,width=1.85,height=4){
        for(const dx of [-width*.3,width*.3])box(g,x+dx,.15,z,.2,.3,1.3,C.steel);
        box(g,x,height/2+.25,z,width,height,1.65,C.wall);box(g,x,height/2+.25,z+.87,width-.14,height-.18,.1,C.blue);
        box(g,x,height*.7,z+.94,width*.6,.7,.055,C.dark);box(g,x,height*.7,z+.98,width*.47,.45,.025,C.glass);
        for(const dx of [-.34,0,.34])cyl(g,x+dx,height*.47,z+.98,.07,.045,dx<0?C.red:dx>0?C.green:C.gold,Math.PI/2);
        box(g,x+width*.33,height*.4,z+1,.07,.6,.09,C.metal);for(let y=.55;y<1.1;y+=.13)box(g,x,y,z+.98,width*.65,.035,.035,C.dark);
        for(const y of [1.2,2.9])box(g,x-width*.43,y,z+.96,.07,.22,.08,C.metal);box(g,x,3.65,z+.935,.48,.24,.04,C.gold);
    }
    function powerDevice(id,title,text,x,z,w,d,height){return device(id,title,text,x,z,'power-assembly',{w,d,height});}
    function device(id,title,text,x,z,kind,options={}){
        const g=group(root,id);g.position.set(x,0,z);g.userData={id,kind:'device',view,title,text:`${text} · 场景设计示意`,anchor:[x,options.height||3.4,z],zone:view.toUpperCase()};
        devices.push(g.userData);hazard(g,0,0,options.w||5,options.d||4);
        if(kind==='cabinet'){
            for(let i=0;i<(options.count||1);i++){
                const dx=i*1.2;box(g,dx,1.3,0,1.08,2.5,.85,C.wall);box(g,dx,1.3,.46,1,2.28,.06,C.blue);
                box(g,dx-.19,1.8,.505,.38,.32,.02,C.dark);box(g,dx+.32,1.25,.52,.05,.3,.04,C.metal);
                for(let h=.5;h<.9;h+=.09)box(g,dx,h,.52,.7,.035,.02,C.metal);
                box(g,dx,2.4,.5,.27,.22,.025,C.gold);box(g,dx+.18,1.83,.52,.06,.06,.025,C.green);
            }
        }else if(kind==='robot'){
            cyl(g,0,.4,0,1,.7,C.steel);cyl(g,0,1.1,0,.55,.8,C.gold);beam(g,[0,1.4,0],[0,3.5,-.5],.3,C.gold);beam(g,[0,3.5,-.5],[2.2,3.7,.1],.25,C.gold);beam(g,[2.2,3.7,.1],[2.8,2.4,.2],.18,C.gold);
            for(const p of [[0,1.4,0],[0,3.5,-.5],[2.2,3.7,.1]])mesh(g,new THREE.SphereGeometry(.38,16,10),C.dark,p);box(g,2.8,2.2,.2,.6,.2,.6,C.metal);for(const dx of [2.5,3.1])box(g,dx,2,.2,.08,.5,.12,C.dark);
            for(const z of [-2,2])rail(g,0,0,z,5.5);
        }else if(kind==='conveyor'){
            box(g,0,1.1,0,20,.35,2.5,C.blue);for(let x=-9.5;x<10;x+=.6)cyl(g,x,1.32,0,.16,2.25,C.metal,Math.PI/2);for(const x of [-8,-4,0,4,8])for(const z of [-.9,.9])box(g,x,.5,z,.16,1,.16,C.steel);
            for(const x of [-6,0,6])box(g,x,1.7,0,1.9,.65,1.2,C.wall);for(const z of [-1.35,1.35])box(g,0,1.5,z,20,.08,.06,C.gold);
            for(const x of [-8,-4,0,4,8])for(const side of [-1,1]){box(g,x,1.3,side*1.35,.07,.5,.07,C.steel);box(g,x,1.12,side*1.28,.22,.14,.3,C.steel);}
        }else if(kind==='press'){
            box(g,0,.4,0,3.2,.8,2.6,C.steel);for(const dx of [-1.15,1.15])box(g,dx,2.9,0,.55,5,2.1,C.blue);
            box(g,0,5.1,0,3.4,.7,2.2,C.blue);cyl(g,0,4.1,0,.42,1.4,C.metal);box(g,0,3.35,0,2.25,.45,1.8,C.gold);box(g,0,1.7,0,2.2,.45,2,C.metal);
            box(g,1.75,1.7,.8,.6,1,.55,C.wall);box(g,1.75,1.9,1.09,.42,.28,.04,C.dark);
        }else if(kind==='cnc'){
            box(g,0,1.6,0,4.3,3,2.6,C.wall);box(g,0,1.8,1.32,2.4,1.8,.08,C.blue);box(g,0,1.95,1.38,1.8,1.15,.04,C.glass);
            box(g,1.85,1.8,1.42,.68,1.35,.16,C.dark);box(g,1.85,2.1,1.52,.48,.42,.04,C.glass);
            for(const dx of [-.75,.75])box(g,dx,1.8,1.45,.055,.65,.05,C.metal);cyl(g,1.7,3.15,0,.065,.4,C.steel);cyl(g,1.7,3.4,0,.08,.4,C.green);
        }else if(kind==='compressor'){
            cyl(g,0,.8,0,.75,3.5,C.blue,0,Math.PI/2);for(const dx of [-1.3,1.3])box(g,dx,.25,0,.3,.5,1.1,C.steel);
            box(g,-.6,1.9,0,1.2,.65,.8,C.metal);for(let x=-1.1;x<0;x+=.13)box(g,x,1.95,.43,.065,.6,.09,C.steel);
            cyl(g,.85,1.8,0,.38,.8,C.dark,0,Math.PI/2);pipe(g,[[0,2,0],[.4,2.5,0],[1.2,2.5,0],[1.2,1,0]],.07);pipe(g,[[1.2,1.2,0],[1.2,1.2,.35]],.07);valve(g,1.2,1.2,.35);
        }else if(kind==='pump'){
            for(const dx of [-1.05,1.05]){box(g,dx,.2,0,1.6,.3,2.4,C.steel);cyl(g,dx,.8,.5,.43,1.25,C.blue,Math.PI/2);cyl(g,dx,.7,-.4,.38,.8,C.metal,Math.PI/2);pipe(g,[[dx,.6,-.7],[dx,1.8,-.7],[dx,1.8,-1.5]],.13);valve(g,dx,1.8,-1.1);}
            pipe(g,[[-1.05,1.8,-1.5],[1.05,1.8,-1.5],[1.05,1.8,-2]],.15,C.green);
        }else if(kind==='tank'){
            for(const dx of [-1.4,1.4]){
                cyl(g,dx,2.1,0,1.05,3.6,C.metal);mesh(g,new THREE.SphereGeometry(1.04,24,12,0,Math.PI*2,0,Math.PI/2),C.metal,[dx,3.9,0]);
                for(const z of [-.7,.7])box(g,dx,.3,z,.3,.6,.3,C.steel);pipe(g,[[dx,3.9,0],[dx,4.5,0],[dx,4.5,-2]],.13);valve(g,dx,1.7,1.05);
            }
            pipe(g,[[-1.4,4.5,-2],[1.4,4.5,-2]],.14);rail(g,0,0,1.8,4.5);
        }else if(kind==='transformer'){
            box(g,0,.3,0,3,.6,2.4,C.steel);box(g,0,1.6,0,2.4,2.3,1.6,C.blue);
            for(let x=-1.5;x<1.6;x+=.2)for(const z of [-1.15,1.15])box(g,x,1.7,z,.07,2, .5,C.metal);
            for(const dx of [-.7,0,.7]){cyl(g,dx,3.05,0,.12,.9,C.dark);for(let h=2.8;h<3.4;h+=.15)cyl(g,dx,h,0,.21,.055,C.wall);}
            pipe(g,[[-.7,3.5,0],[-.7,4.2,0],[1.7,4.2,0]],.055,C.red);
            for(const x of [-2.2,2.2]){box(g,x,1.4,0,.055,2.8,4.5,C.gold);for(let z=-2;z<2;z+=.25)box(g,x,1.4,z,.04,2.8,.035,C.steel);}
        }else if(kind==='valves'){
            for(let i=0;i<4;i++){
                const zz=-1.35+i*.9;pipe(g,[[-2.5,1.4,zz],[2.5,1.4,zz]],.15,i%2?C.blue:C.green);valve(g,-.8,1.4,zz);valve(g,.9,1.4,zz);
                for(const x of [-2.5,2.5]){box(g,x,.65,zz,.12,1.3,.12,C.steel);cyl(g,x,1.4,zz,.23,.13,C.metal,0,Math.PI/2);}
                const gauge=mesh(g,new THREE.CylinderGeometry(.19,.19,.07,20),C.wall,[0,1.95,zz]);gauge.rotation.x=Math.PI/2;box(g,0,1.95,zz+.05,.018,.2,.02,C.dark,0,0,.5);
            }
        }else if(kind==='hv'){
            for(const dx of [-1.5,0,1.5]){box(g,dx,1.25,0,1.2,2.5,1.2,C.wall);box(g,dx,1.6,.64,.75,.45,.04,C.dark);for(let i=0;i<6;i++)cyl(g,dx,2.8+i*.16,0,.24,.06,C.wall);cyl(g,dx,3.3,0,.09,1.1,C.metal);}
            pipe(g,[[-1.5,3.65,0],[1.5,3.65,0]],.08,C.red);rail(g,0,0,2,5.5);
        }else if(kind==='console'){
            box(g,0,.8,0,3.6,1.6,1.2,C.blue);box(g,0,1.65,0,3.65,.16,1.5,C.metal,.18);
            for(const dx of [-1,0,1]){box(g,dx,1.85,-.3,.12,.45,.12,C.steel);box(g,dx,2.15,-.3,.85,.55,.08,C.dark);box(g,dx,2.15,-.24,.73,.4,.02,C.glass);}
            for(let dx=-1.3;dx<=1.3;dx+=.3)box(g,dx,1.8,.42,.075,.04,.075,C.gold);
        }else if(kind==='welding'){
            box(g,0,.8,0,3.2,.15,2,C.metal);for(const dx of [-1.3,1.3])for(const dz of [-.8,.8])box(g,dx,.4,dz,.12,.8,.12,C.steel);
            box(g,1.8,.65,0,.8,1.3,.85,C.blue);pipe(g,[[1.8,.7,.5],[1,1,.8],[0,1,.4]],.025,C.dark);cyl(g,-1.8,.9,-.6,.3,1.8,C.green);valve(g,-1.8,1.9,-.6);
            for(const dx of [-2.3,2.3])box(g,dx,1.5,-1.3,.09,3,.09,C.steel);box(g,0,1.5,-1.3,4.7,2.8,.08,0x7d694c);
        }
        return g;
    }
    function hall(g,x,z,w,d,h,roof=true,windows=true){
        box(g,x,roof?.18:-.175,z,w,.35,d,C.concrete);box(g,x,h/2,z-d/2,w,h,.4,C.wall);
        for(const dx of [-w/2,w/2])if(roof)box(g,x+dx,h/2,z,.35,h,d,C.wall);
        if(!roof)box(g,x-w/2,1,z,.35,2,d,C.wall);
        for(let dx=-w/2+3;dx<w/2;dx+=6){box(g,x+dx,h/2,z-d/2-.25,.35,h,.35,C.steel);if(windows)box(g,x+dx,h*.72,z-d/2+.24,4,1.1,.04,C.glass);}
        for(let zz=-d/2;zz<=d/2;zz+=6)for(const dx of [-w/2,w/2])box(g,x+dx,h/2,z+zz,.36,h,.36,C.steel);
        if(roof){
            const slope=Math.atan(1.8/(d/2));for(const side of [-1,1]){box(g,x,h+.9,z+side*d/4,w+1,.2,d/2+1,C.blue,side*slope);for(let dx=-w/2;dx<w/2;dx+=.8)box(g,x+dx,h+1,z+side*d/4,.07,.08,d/2+1,C.metal,side*slope);}
            for(let dx=-w/2+6;dx<w/2;dx+=12)box(g,x+dx,h+1.9,z,7,.15,2.2,C.glass);
            for(let dx=-w/2+5;dx<w/2;dx+=10){box(g,x+dx,h/2,z+d/2,8,h,.35,C.wall);box(g,x+dx,3,z+d/2+.25,5,6,.12,C.blue);for(let y=.4;y<6;y+=.22)box(g,x+dx,y,z+d/2+.33,4.9,.03,.03,C.metal);}
        }
    }
    function gantry(g,x,z,w=22,h=11){
        for(const dx of [-w/2,w/2]){box(g,x+dx,h/2,z,1,h,1,C.gold);box(g,x+dx,.4,z,2.2,.7,5,C.steel);for(const dz of [-1.7,1.7])cyl(g,x+dx,.35,z+dz,.3,.35,C.dark,Math.PI/2);beam(g,[x+dx,h-3,z],[x+dx+(dx<0?3:-3),h,z],.12,C.gold);}
        box(g,x,h,z,w+2,1,1.5,C.gold);box(g,x+2,h-.8,z,3,.6,2.2,C.steel);cyl(g,x+2,h-3,z,.025,4,C.dark);mesh(g,new THREE.TorusGeometry(.25,.055,8,20,Math.PI*1.5),C.dark,[x+2,h-5.1,z]);
    }
    function excavator(g,x,z,angle=0){
        const e=group(g,'履带挖掘机');e.position.set(x,0,z);e.rotation.y=angle;
        for(const dx of [-1.4,1.4]){box(e,dx,.55,0,.8,1,4.5,C.dark);for(let zz=-1.8;zz<2;zz+=.55)cyl(e,dx,.55,zz,.34,.88,C.steel,0,Math.PI/2);}
        cyl(e,0,1.15,0,1.1,.45,C.steel);box(e,0,1.7,0,2.9,.9,3.5,C.gold);box(e,-.65,2.7,.2,1.6,1.8,1.7,C.blue);box(e,-.65,2.9,1.1,1.25,1.1,.05,C.glass);box(e,.8,2.2,-.8,1.1,.8,1.5,C.gold);
        beam(e,[.7,2,1.2],[.7,5.1,3.5],.24,C.gold);beam(e,[.7,5.1,3.5],[.7,1.9,6.1],.2,C.gold);beam(e,[.7,2.3,1.4],[.7,4.7,2.9],.07,C.metal);beam(e,[.7,4.8,3.6],[.7,2.8,5.4],.055,C.metal);
        box(e,.7,1.3,6.2,1.2,.7,1.3,C.dark,.4);for(let dx=.2;dx<1.3;dx+=.25)box(e,dx,.95,6.8,.12,.2,.4,C.metal,.35);
        return e;
    }
    function truck(g,x,z){
        const t=group(g,'工程运输车');t.position.set(x,0,z);box(t,0,.8,0,2.8,.45,7,C.steel);box(t,0,1.8,2.3,2.8,2.2,2.2,C.gold);box(t,0,2.3,3.43,2.3,.9,.04,C.glass);box(t,0,1.8,-1.1,2.9,1.7,4.2,C.blue);
        for(const dx of [-1.55,1.55])for(const zz of [-2,-.6,2.4])cyl(t,dx,.65,zz,.58,.4,C.dark,0,Math.PI/2);
        return t;
    }
    if(view==='overview'){
        box(root,0,-.65,0,164,1.3,118,C.concrete);box(root,0,-1.6,0,168,.8,122,C.dark);
        for(const x of [-73,73])box(root,x,.03,0,10,.05,110,C.dark);for(const z of [-51,51])box(root,0,.035,z,146,.05,10,C.dark);
        for(let z=-46;z<48;z+=6)for(const x of [-73,73])box(root,x,.08,z,.15,.04,2.8,C.wall);
        for(let x=-68;x<70;x+=6)for(const z of [-51,51])box(root,x,.08,z,2.8,.04,.15,C.wall);
        hall(root,-28,-19,69,43,13);
        if(!imported(root,'building-r.glb',[39,.1,-28],[42,16,29]))hall(root,39,-28,42,29,13);
        if(!imported(root,'building-a.glb',[-48,.1,32],[30,12,22]))hall(root,-48,32,30,22,9);
        if(!imported(root,'building-k.glb',[52,.1,32],[25,10,23]))hall(root,52,32,25,23,9);
        // Open assembly yard, separated from the excavation and pedestrian circulation.
        const yardCrane=group(root,'E-05');gantry(yardCrane,28,6,28,15);registerEquipment(yardCrane,'E-05','室外龙门起重机',[30,15.8,6]);for(const x of [14,42])box(root,x,.12,6,.18,.14,24,C.metal);
        for(let i=0;i<5;i++)for(let j=0;j<3;j++)cyl(root,19+i*3,.5,8+j*2,.4,7,C.metal,Math.PI/2);
        box(root,-18,.04,27,36,.06,26,C.earth);box(root,-18,.13,27,22,.1,14,0x73583f);
        for(const x of [-37,1])for(let z=15;z<41;z+=3){box(root,x,.7,z,.15,1.4,.15,C.gold);box(root,x,.8,z+1.4,.12,.09,2.8,C.gold);}
        for(let i=0;i<4;i++)mesh(root,new THREE.ConeGeometry(2.5+i*.2,2,10),C.earth,[-29+i*3,.95,35]);
        registerEquipment(excavator(root,-24,23,.5),'E-01','履带挖掘机一号',[-24,5.7,23],true,['Z001']);registerEquipment(excavator(root,-8,30,-.7),'E-02','履带挖掘机二号',[-8,5.7,30],true,['Z001']);registerEquipment(truck(root,9,33),'E-03','土方运输车',[9,3.5,33],true);registerEquipment(truck(root,55,5),'E-04','工程运输车',[55,3.5,5],true);
        for(const x of [-79,79])for(let z=-56;z<58;z+=4){box(root,x,1.4,z,.09,2.8,.09,C.steel);box(root,x,1.2,z+2,.055,2.4,3.8,C.metal);}
        for(const z of [-57,57])for(let x=-77;x<80;x+=4){if(z>0&&Math.abs(x)<8)continue;box(root,x,1.4,z,.09,2.8,.09,C.steel);box(root,x+2,1.2,z,3.8,2.4,.055,C.metal);}
        box(root,12,1.9,56,5,3.8,4,C.wall);box(root,12,4,56,5.5,.2,4.5,C.blue);
        for(let x=-63;x<66;x+=18){cyl(root,x,3.5,47,.07,7,C.steel);box(root,x,7,47,1.5,.12,.5,C.wall);}
        const outdoorTanks=group(root,'E-06');for(const x of [8,16]){if(!imported(outdoorTanks,'tank.glb',[x,0,-37],[5,10,5]))cyl(outdoorTanks,x,5,-37,2.5,10,C.metal);}registerEquipment(outdoorTanks,'E-06','厂区储罐组',[12,10.8,-37]);
        root.userData.locations=[{id:'A',kind:'model',title:'A 区 · 自动化装配车间',text:'进入高跨钢结构车间查看机器人、装配线和机械设备。',anchor:[-28,16,-18],view:'a'},{id:'B',kind:'model',title:'B 区 · 地下动力室',text:'进入 L 形地下动力室查看高压设备、阀门组与控制柜。',anchor:[40,17,-28],view:'b'}];
    }else{
        const w=view==='a'?82:96,d=view==='a'?46:64;
        root.userData.architecture=view==='a'?'high-bay-steel':'power-hall-with-control-wing';
        workShell(view);
        if(view==='a'){
        // The floor and rear walls follow the same polygon as the exterior building.
        box(root,0,.032,0,w-2,.025,3.6,C.green);for(const z of [-2,2])box(root,0,.053,z,w-2,.025,.08,C.gold);
        const roofFrame=group(root,'steel-roof-trusses');for(const x of [-w/2,w/2])for(const z of [-18,-2,16]){post(roofFrame,x,z,13.85,.5);box(roofFrame,x,13.4,z,.8,.8,.8,C.steel);}
        for(const z of [-18,-2,16]){box(roofFrame,0,13.6,z,w,.5,.5,C.steel);for(let x=-34;x<34;x+=5){beam(roofFrame,[x,13.5,z],[x+2.5,12.1,z],.075,C.steel);beam(roofFrame,[x+2.5,12.1,z],[x+5,13.5,z],.075,C.steel);}box(roofFrame,0,12.1,z,w,.15,.15,C.steel);}
        for(const x of [-41,-20,0,20,41])box(roofFrame,x,13.6,-1,.25,.25,34.5,C.steel);
        for(const x of [-41,41])for(const z of [-18,-2])beam(roofFrame,[x,12.1,z],[x,13.6,z+16],.09,C.steel);
        for(const z of [-14,14])box(roofFrame,0,13.6,z,w,.2,.2,C.steel);
        const lighting=group(root,'assembly-lighting');box(lighting,0,13.1,-8,72,.14,.15,C.steel);
        for(const x of [-20,0,20])beam(lighting,[x,13.1,-8],[x,13.6,-8],.045,C.steel);
        for(let x=-28;x<30;x+=8){beam(lighting,[x,12.68,-8],[x,13.1,-8],.035,C.steel);box(lighting,x,12.7,-8,3,.08,.55,0xf0e8cd);box(lighting,x,12.65,-8,2.5,.035,.3,0xffffff);}
        const assemblyTrays=group(root,'assembly-cable-trays');
        for(const z of [-14,14]){
            for(const dz of [-.55,.55])box(assemblyTrays,0,7.6,z+dz,w-.6,.16,.1,C.steel);
            for(let x=-w/2+1;x<w/2-1;x+=.55)box(assemblyTrays,x,7.55,z,.065,.065,1.1,C.metal);
            for(const x of [-40,-20,0,20,40]){for(const dz of [-.55,.55])beam(assemblyTrays,[x,7.55,z+dz],[x,13.6,z+dz],.035,C.steel);box(assemblyTrays,x,13.6,z,.12,.12,1.5,C.steel);box(assemblyTrays,x,7.5,z,.14,.1,1.5,C.steel);}
            pipe(assemblyTrays,[[-40,7.65,z-.2],[40,7.65,z-.2]],.055,C.dark);
        }
        }else{
            const aisles=group(root,'power-service-aisles');box(aisles,-1,.032,0,84,.025,4.2,C.green);box(aisles,49,.032,3,20,.025,3.6,C.green);
            for(const z of [-2.3,2.3])box(aisles,-1,.053,z,84,.025,.09,C.gold);
            for(const z of [-14,7]){box(aisles,-3,.032,z,78,.025,2.4,0x46595d);for(const edge of [-1.3,1.3])box(aisles,-3,.055,z+edge,78,.025,.08,C.gold);}
            for(let x=-37;x<40;x+=12){box(aisles,x,.062,0,1.6,.025,.12,0xc5d3b0);box(aisles,x+.5,.062,.2,.7,.025,.12,0xc5d3b0,0,-.55);box(aisles,x+.5,.062,-.2,.7,.025,.12,0xc5d3b0,0,.55);}
            const trench=group(root,'grated-cable-channel');box(trench,-20,.055,-3.3,46,.1,.9,C.dark);for(let x=-42;x<3;x+=.45)box(trench,x,.12,-3.3,.08,.06,.9,C.metal);
            const stairs=group(root,'basement-access-stairs');for(let i=0;i<8;i++)box(stairs,-34,(i+1)*.1,25-i*.5,3,(i+1)*.2,.5,C.concrete);
            const bridge=group(root,'power-pipe-and-cable-bridge');
            const pipeLines=[{z:5.8,rear:-30,y:7.3,x:38,color:C.blue},{z:6.7,rear:-28.9,y:7.8,x:39,color:C.green},{z:7.6,rear:-27.8,y:8.3,x:40,color:C.metal}];
            for(const x of [-40,-20,0,20,38]){
                post(bridge,x,5.2,7.14,.25);box(bridge,x,7.02,6.4,.28,.24,3.2,C.steel);beam(bridge,[x,5.7,5.2],[x,7.02,7.6],.07,C.steel);
                post(bridge,x,-29,7.3,.22);box(bridge,x,7.2,-29,.28,.2,3.5,C.steel);
                for(const line of pipeLines){const mid=(7.14+line.y-.2)/2;box(bridge,x,mid,line.z,.14,Math.max(.06,line.y-.2-7.14+.04),.14,C.steel);ring(bridge,x,line.y,line.z,.24,C.steel,0,Math.PI/2);
                    const low=7.3,high=line.y+.2-.22;box(bridge,x,(low+high)/2,line.rear,.14,Math.max(.08,high-low),.14,C.steel);ring(bridge,x,line.y+.2,line.rear,.29,C.steel,0,Math.PI/2);}
            }
            box(bridge,-1,6.98,5.2,78,.22,.22,C.steel);box(bridge,-1,7.1,-29,78,.2,.2,C.steel);
            for(const z of [-24,-14,-4]){post(bridge,37,z,7.3,.22);box(bridge,38.6,7.2,z,3.6,.2,.2,C.steel);beam(bridge,[37,5.9,z],[40,7.2,z],.07,C.steel);
                for(const line of pipeLines){box(bridge,line.x,(7.3+line.y-.02)/2,z,.12,Math.max(.08,line.y-.02-7.3),.12,C.steel);ring(bridge,line.x,line.y+.2,z,.29,C.steel,Math.PI/2);}}
            for(const line of pipeLines){powerPipe(bridge,[[-43,line.y+.2,line.rear],[line.x,line.y+.2,line.rear],[line.x,line.y+.2,line.z],[line.x,line.y,line.z],[-40,line.y,line.z]],.22,line.color);pipeCap(bridge,[-43,line.y+.2,line.rear],[1,0,0]);pipeCap(bridge,[-40,line.y,line.z],[1,0,0]);}
            const tray=group(root,'power-cable-trays');for(const z of [-12.5,26]){
                for(const dz of [-.5,.5])box(tray,-19,6.3,z+dz,46,.14,.12,C.steel);for(let x=-42;x<4;x+=.6)box(tray,x,6.26,z,.08,.08,1,C.metal);
                for(const x of [-40,-26,-12,2]){post(tray,x,z+.9,6.3,.18);box(tray,x,6.15,z+.1,.22,.18,1.9,C.steel);beam(tray,[x,4.95,z+.9],[x,6.15,z-.5],.06,C.steel);}
                box(tray,-19,6.3,z+.9,46,.16,.16,C.steel);for(const x of [-42,4])box(tray,x,6.3,z,.12,.16,1.1,C.steel);
                for(const dz of [-.3,0,.3])pipe(tray,[[-42,6.36,z+dz],[4,6.36,z+dz],[4,.3,z+dz]],.04,C.dark);
                box(tray,4,.3,z,.65,.6,1.4,C.blue);
            }
            const rearStart=FOOTPRINTS.b[1],rearEnd=FOOTPRINTS.b[2],rearSlope=(rearEnd[1]-rearStart[1])/(rearEnd[0]-rearStart[0]);
            for(const x of [-38,-16,8,32]){const rearZ=rearStart[1]+(x-rearStart[0])*rearSlope;
                if(!imported(root,'wall-vent.glb',[x,3.4,rearZ+.455],[3.3,2.1,.35],-Math.atan(rearSlope))){box(root,x,4.4,rearZ+.39,3.3,2.1,.2,C.dark,0,-Math.atan(rearSlope));for(let y=3.5;y<5.4;y+=.18)box(root,x,y,rearZ+.5,3,.08,.1,C.metal);}}
            const wing=group(root,'power-control-wing');for(const z of [-2,17])box(wing,44.5,1.1,z,.18,2.2,8,C.wall);box(wing,54,.035,8,17,.03,16,0x627a80);
            for(const x of [49,54,59]){post(wing,x,15,4.85,.16);box(wing,x,.9,14.5,.65,.15,1.5,C.steel);}box(wing,54,3.8,15,11,2,.28,C.blue);for(const x of [50.5,54,57.5]){box(wing,x,3.8,14.82,3,1.55,.055,C.dark);box(wing,x,3.8,14.77,2.7,1.28,.035,C.glass);}
        }
        if(view==='a'){
            device('A-01','液压冲压机','巡检关注：运动夹点、液压压力与防护联锁',-20,-9,'press',{height:5.9,w:5.5,d:5.5});
            device('A-02','数控加工中心','巡检关注：旋转主轴、防护门与切屑飞溅',-8,-9,'cnc',{height:3.8,w:6,d:5});
            device('A-03','压缩空气储气罐','巡检关注：容器压力、泄压阀与管线连接',7,-9,'tank',{height:5.2,w:6,d:6});
            device('A-04','气瓶焊接工作站','巡检关注：气瓶固定、软管与动火隔离',20,-8,'welding',{height:3.5,w:6,d:6});
            device('A-05','空气压缩机组','巡检关注：高温表面、传动机构与泄漏',-19,9,'compressor',{height:3.2,w:6,d:5});
            device('A-06','车间低压配电箱','巡检关注：箱门、接地与支路保护',-7,9,'cabinet',{height:3.2,w:4,d:4,count:2});
            device('A-07','双联循环水泵组','巡检关注：联轴器防护、振动与积水',8,9,'pump',{height:3,w:6,d:6});
            device('A-08','生产线操作台','巡检关注：急停、控制按钮与操作权限',21,9,'console',{height:3,w:5,d:4});
            const crane=group(root,'A-09');gantry(crane,0,4,58,11.7);crane.userData={id:'A-09',kind:'device',view,title:'车间桥式起重机',text:'巡检关注：吊具、行程限位与吊运隔离 · 场景设计示意',anchor:[2,12.5,4],zone:'A'};devices.push(crane.userData);
            device('A-10','装配工业机器人','巡检关注：机械臂运动范围、防护联锁',-16,-17,'robot',{height:4.5,w:6,d:5});device('A-11','搬运工业机器人','巡检关注：机械臂运动范围、夹具防护',13,-17,'robot',{height:4.5,w:6,d:5});device('A-12','滚筒输送装配线','巡检关注：输送夹点、急停与光电保护',-1,-17,'conveyor',{height:2.6,w:21,d:3});
            const racks=group(root,'assembly-material-racks');for(const x of [-29,29]){for(const dx of [-3,3])for(const z of [11,18])box(racks,x+dx,2.6,z,.2,5.2,.2,C.blue);for(const y of [1,2.7,4.4]){box(racks,x,y,14.5,6.5,.15,7.5,C.metal);for(const dx of [-1.6,1.6])for(const z of [12.5,16.5])box(racks,x+dx,y+.55,z,2.2,1,2,0x9a8770);}}
            const packing=group(root,'assembly-packing-bench');box(packing,1,1.05,18,10,.2,2.8,C.metal);for(const x of [-3,1,5])for(const z of [17,19])box(packing,x,.5,z,.18,1,.18,C.blue);for(const x of [-2,2,5]){box(packing,x,1.55,18,1.4,.9,1.5,C.blue);cyl(packing,x,2.1,18,.22,.3,C.metal);}
            for(const x of [-31,31])for(const z of [-18,18]){if(!imported(root,'pallet.glb',[x,0,z],[1.8,.2,1.3]))box(root,x,.1,z,1.8,.2,1.3,0x907854);imported(root,'barrel.glb',[x,.2,z],[.8,1.25,.8]);}
        }else{
            const hv=powerDevice('B-01','10kV 高压开关柜','巡检关注：成套开关柜、联锁、母线与绝缘隔离',-31,-22,20,10,6.8);
            box(hv,0,.2,0,18,.4,3.4,C.steel);for(let i=0;i<8;i++){const x=-7.35+i*2.1;powerPanel(hv,x,0,1.95,4.5);for(const z of [-.55,0,.55]){beam(hv,[x,4.72,z],[x,5.9,z],.07,C.dark);for(const y of [5,5.2,5.4])cyl(hv,x,y,z,.19,.08,C.wall);}}
            for(const z of [-.55,0,.55])powerPipe(hv,[[-8.3,5.9,z],[8.3,5.9,z]],.085,z<0?C.red:z>0?C.blue:C.gold);rail(hv,0,0,4.4,18);for(const x of [-9,9])box(hv,x,1.1,3.2,.08,2.2,2.4,C.gold);

            const transformer=powerDevice('B-02','油浸式变压器','巡检关注：散热片、套管、油位与围栏完整性',-8,-22,14,12,8);
            box(transformer,0,.3,0,6.2,.6,5.8,C.steel);box(transformer,0,2.5,0,5,4,3.5,C.blue);box(transformer,0,4.6,0,5.4,.25,3.9,C.metal);
            for(const side of [-1,1])for(let z=-2.1;z<=2.1;z+=.23)box(transformer,side*3.3,2.6,z,1.45,3.7,.095,C.metal);
            for(const side of [-1,1])for(const y of [.9,4.2]){box(transformer,side*3.2,y,0,1.6,.22,4.7,C.steel);powerPipe(transformer,[[side*2.3,y,0],[side*3.2,y,0]],.14);}
            for(const x of [-1.65,0,1.65]){cyl(transformer,x,5.5,.6,.14,1.8,C.dark);for(let y=4.9;y<6.4;y+=.19)cyl(transformer,x,y,.6,.3,.09,C.wall);}
            cyl(transformer,0,6.2,-1.3,.62,5.3,C.metal,0,Math.PI/2);powerPipe(transformer,[[-2.1,6.2,-1.3],[-2.5,6.2,-1.3],[-2.5,3.4,-1.3]],.12);dial(transformer,1.2,3.3,1.85,.35);
            for(const x of [-1.6,1.6]){post(transformer,x,-1.3,5.7,.18,4.725);box(transformer,x,5.62,-1.3,.22,.15,1.3,C.steel);}beam(transformer,[1.2,3.3,1.68],[1.2,3.3,1.85],.075,C.steel);
            for(const x of [-6.3,6.3]){for(const z of [-4.8,4.8])box(transformer,x,1.5,z,.12,3,.12,C.gold);for(let z=-4.8;z<4.9;z+=.4)box(transformer,x,1.5,z,.07,2.7,.07,C.steel);box(transformer,x,2.9,0,.12,.12,9.8,C.gold);}rail(transformer,0,0,5.1,12.6);

            const valves=powerDevice('B-03','工艺介质阀门组','巡检关注：阀位、法兰、压力表与介质隔离',19,-22,17,10,4.3);
            for(const z of [-3,-1,1,3]){const color=z<0?C.blue:C.green;powerPipe(valves,[[-7,1.9,z],[7,1.9,z]],.2,color);for(const x of [-3,3])if(!imported(valves,'industrial-pipes#pipe08',[x,1.9,z],[1.8,1.4,1.4],0,.34))valve(valves,x,1.9,z);
                for(const x of [-6,0,6])post(valves,x,z,1.93,.16);dial(valves,0,3.1,z+.12,.3);gaugeStem(valves,0,3.1,z+.12,1.9,z);}
            for(const x of [-7,7])powerPipe(valves,[[x,1.9,-3],[x,1.9,3]],.28,C.metal);

            const plc=powerDevice('B-04','仪表与 PLC 控制柜','巡检关注：PLC、仪表屏、线缆与柜内供电',-32,17,17,8,5.5);
            box(plc,0,.16,0,16,.32,3,C.steel);for(let i=0;i<7;i++){powerPanel(plc,-6+i*2,0,1.85,4);if(i%2===0)dial(plc,-6+i*2,2.05,1.02,.22);}for(const x of [-6,-2,2,6])powerPipe(plc,[[x,.3,-.5],[x,.4,-2.6],[x,.15,-2.6]],.045,C.dark);

            const pumps=powerDevice('B-05','循环排水泵组','巡检关注：三泵联轴器、止回阀、压力表与积水',-10,17,17,12,4.8);
            box(pumps,0,.18,0,14,.36,9,C.steel);for(const x of [-4,0,4]){motor(pumps,x,1.2,1.2,2.6,-1);cyl(pumps,x,1.35,-1.3,.87,.9,C.green,Math.PI/2);mesh(pumps,new THREE.TorusGeometry(.72,.16,8,24),C.green,[x,1.35,-1.85]);box(pumps,x,.45,-1.3,1.4,.3,.95,C.steel);
                powerPipe(pumps,[[x,1.3,-1.8],[x,1.3,-3.8]],.24,C.blue);powerPipe(pumps,[[x,2.1,-1.3],[x,3.2,-1.3],[x,3.2,-3]],.2,C.green);dial(pumps,x,2.8,-.95,.28);gaugeStem(pumps,x,2.8,-.95,2.1,-1.3);}
            for(const [z,y,color,xEnd] of [[-3.8,1.3,C.blue,6],[-3,3.2,C.green,-6]]){powerPipe(pumps,[[-6,y,z],[6,y,z]],.34,color);powerPipe(pumps,[[xEnd,y,z],[xEnd,y,3.8]],.34,color);pipeCap(pumps,[xEnd===6?-6:6,y,z],[1,0,0],.34);
                for(const x of [-5,5]){post(pumps,x,z,y-.25,.16,.36);box(pumps,x,y-.3,z,.4,.16,.7,C.steel);}}
            if(!imported(pumps,'industrial-pipes#pipe08',[6,1.3,3],[1.6,1.5,1.5],Math.PI/2,.578))valve(pumps,6,1.3,3);valve(pumps,-6,3.2,3);

            const tanks=powerDevice('B-06','压力稳压装置','巡检关注：三联压力容器、泄压阀、平台与液位',16,17,14,12,7.6);
            for(const x of [-3.4,0,3.4]){cyl(tanks,x,3.2,0,1.15,4.9,C.metal);mesh(tanks,new THREE.SphereGeometry(1.15,24,12,0,Math.PI*2,0,Math.PI/2),C.metal,[x,5.65,0]);for(const z of [-.65,.65])box(tanks,x,.6,z,.3,1.2,.3,C.steel);
                for(const y of [1.5,4.9])ring(tanks,x,y,0,1.17,C.steel,Math.PI/2);dial(tanks,x,3.1,1.23,.28);powerPipe(tanks,[[x,6.7,0],[x,7.1,0],[x,7.1,-3]],.16);powerPipe(tanks,[[x,1.4,.85],[x,1.4,1.4]],.12);valve(tanks,x,1.4,1.4);beam(tanks,[x,3.1,1.05],[x,3.1,1.23],.07,C.steel);}
            powerPipe(tanks,[[-4,7.1,-3],[4,7.1,-3],[4,1.5,-3]],.22);pipeCap(tanks,[-4,7.1,-3],[1,0,0]);box(tanks,0,1.2,-3.7,10,.18,1.4,C.steel);rail(tanks,0,1.29,-4.3,10);
            for(const x of [-4,0,4])for(const z of [-4.2,-3.2])post(tanks,x,z,1.2,.14);box(tanks,4.9,1.2,-2.7,2,.18,3,C.steel);for(const z of [-3.7,-1.5])post(tanks,5.6,z,1.2,.14);
            for(let y=.4;y<=1.21;y+=.4)box(tanks,5.6,y,-2,.16,.08,.85,C.metal);for(const z of [-2.45,-1.55])post(tanks,5.6,z,1.8,.09);

            const control=powerDevice('B-07','动力监控操作台','巡检关注：三联监控、急停、操作权限与报警响应',54,10,14,8,4.4);
            for(const x of [-4,0,4]){box(control,x,1.2,0,3.7,2.4,1.8,C.blue);box(control,x,2.5,0,3.8,.18,2.2,C.metal,.15);for(const dx of [-.85,.85]){box(control,x+dx,2.85,-.4,.13,.6,.13,C.steel);box(control,x+dx,3.25,-.4,1.45,.9,.12,C.dark);box(control,x+dx,3.25,-.32,1.28,.7,.035,C.glass);}for(let dx=-1.2;dx<1.4;dx+=.4)box(control,x+dx,2.66,.65,.1,.06,.1,C.gold);
                cyl(control,x,.55,2.5,.08,1.1,C.steel);box(control,x,1.2,2.5,1.3,.16,1.15,C.dark);box(control,x,1.85,3,.95,1.3,.15,C.blue);for(const dx of [-.6,.6])box(control,x+dx,.15,2.5,.1,.1,1.3,C.steel);}

            const exchanger=powerDevice('B-08','板式换热机组','巡检关注：换热板密封、压差与高温管路',18,-7,17,8,5.9);
            box(exchanger,0,.2,0,14,.4,6,C.steel);for(const x of [-4,4]){box(exchanger,x-1.5,2.35,0,.35,4.1,3,C.blue);box(exchanger,x+1.5,2.35,0,.35,4.1,3,C.blue);for(let dx=-1.3;dx<=1.3;dx+=.15)box(exchanger,x+dx,2.35,0,.055,3.7,2.65,C.metal);
                for(const y of [.7,4])for(const z of [-1.4,1.4])beam(exchanger,[x-1.8,y,z],[x+1.8,y,z],.065,C.steel);for(const y of [1.2,3.5])powerPipe(exchanger,[[x+1.7,y,0],[x+2.5,y,0],[x+2.5,y,2.7]],.17,y<2?C.blue:C.green);dial(exchanger,x,4.9,1.1,.27);powerPipe(exchanger,[[x+2.5,3.5,1.1],[x,3.5,1.1],[x,4.9,1.1]],.055);}

            const generator=powerDevice('B-09','备用柴油发电机组','巡检关注：联轴器、燃油管路、散热与高温排气',-32,-7,19,8,6.5);
            box(generator,0,.25,0,16,.5,6,C.steel);box(generator,-3,1.8,0,7,2.8,3,C.green);for(let x=-5.7;x<0;x+=.65){box(generator,x,3.35,0,.42,.4,2.6,C.metal);powerPipe(generator,[[x,3.3,1.4],[x,3.8,1.8],[x,4.2,1.8]],.09,C.steel);}
            cyl(generator,3.2,1.8,0,1.5,4.8,C.blue,0,Math.PI/2);for(let x=1;x<5.7;x+=.35)ring(generator,x,1.8,0,1.5,C.metal,0,Math.PI/2);
            beam(generator,[.3,1.8,0],[1.1,1.8,0],.22,C.metal);box(generator,.7,1.8,0,.9,.9,.9,C.gold);powerPipe(generator,[[-5.7,4.2,1.8],[-.5,4.2,1.8],[-.5,4.2,-.5],[-2,4.2,-.5]],.11);
            box(generator,-7,2.4,0,.5,4,4,C.dark);for(let y=.6;y<4.4;y+=.24)box(generator,-7.3,y,0,.16,.08,3.5,C.metal);powerPipe(generator,[[-2,3.4,-.5],[-2,5.5,-.5],[2,5.5,-.5]],.3,C.steel);cyl(generator,0,5.5,-.5,.5,3.3,C.metal,0,Math.PI/2);powerPanel(generator,7,0,1.5,3.5);
            for(const x of [-1,1])post(generator,x,-.5,5.08,.13,3.2);powerPipe(generator,[[-6.9,1,1],[-5.5,1,1]],.12,C.green);

            const compressor=powerDevice('B-10','双机空气压缩机组','巡检关注：压缩机传动、高温、储气与安全阀',-8,-7,17,8,5.3);
            for(const x of [-4,4]){box(compressor,x,.2,0,6.5,.4,5,C.steel);cyl(compressor,x,1.35,0,1.1,5.8,C.blue,0,Math.PI/2);box(compressor,x-.8,3,0,2.5,1.5,2,C.metal);for(let dx=-1.7;dx<.5;dx+=.22)box(compressor,x+dx,3.1,1.03,.07,1.3,.08,C.steel);motor(compressor,x+1.9,2.9,0,2.5);powerPipe(compressor,[[x,3.6,0],[x,4.5,0],[x,4.5,-2.8]],.11);dial(compressor,x,2,1.15,.25);}
            powerPipe(compressor,[[-6,4.5,-2.8],[6,4.5,-2.8]],.18,C.metal);pipeCap(compressor,[-6,4.5,-2.8],[1,0,0],.18);

            const water=powerDevice('B-11','软化过滤水处理装置','巡检关注：滤罐压差、加药泵、阀门及泄漏',34,16,12,12,6.7);
            box(water,0,.18,0,10,.36,9,C.steel);for(const x of [-2.7,0,2.7]){for(const dx of [-.65,.65])post(water,x+dx,-1,.55,.13,.2);cyl(water,x,2.5,-1,1,4.1,C.green);mesh(water,new THREE.SphereGeometry(1,20,12,0,Math.PI*2,0,Math.PI/2),C.green,[x,4.55,-1]);powerPipe(water,[[x,5.5,-1],[x,5.9,-1],[x,5.9,-3.8]],.15);dial(water,x,2.7,.05,.25);beam(water,[x,2.7,-.1],[x,2.7,.05],.06,C.steel);}
            powerPipe(water,[[-3.5,5.9,-3.8],[3.5,5.9,-3.8],[3.5,1.3,-3.8]],.22);pipeCap(water,[-3.5,5.9,-3.8],[1,0,0]);for(const x of [-2.7,0,2.7]){cyl(water,x,.8,2.7,.62,1.4,C.wall);box(water,x,1.6,2.7,.7,.3,.7,C.blue);powerPipe(water,[[x,1.7,2.7],[x,2.3,2.7],[x,2.3,-.1]],.035,C.dark);}

            const ups=powerDevice('B-12','UPS 与蓄电池柜','巡检关注：直流短路、端子防护、电池温度与通风',54,-2,13,6,5.1);
            for(const x of [-4,0,4]){powerPanel(ups,x,-1,1.9,3.8);for(const y of [.7,1.7,2.7]){box(ups,x,y,1.9,2.5,.12,1.5,C.steel);for(const dx of [-.6,.6]){box(ups,x+dx,y+.4,1.9,.85,.62,1,C.dark);box(ups,x+dx,y+.75,1.9,.5,.08,.5,C.gold);}}for(const dx of [-1.25,1.25])box(ups,x+dx,1.8,1.9,.08,3.6,.08,C.steel);}

            const services=group(root,'power-service-connections');
            powerPipe(services,[[26,1.9,-23],[29,1.9,-23],[29,7.5,-23],[38,7.5,-23]],.18,C.blue);
            powerPipe(services,[[-4,1.3,20.8],[-4,7.3,20.8],[-4,7.3,5.8]],.18,C.blue);
            powerPipe(services,[[20,1.5,14],[25,1.5,14],[25,8,14],[39,8,14],[39,8,6.7]],.18,C.green);
            powerPipe(services,[[24.5,3.5,-4.3],[24.5,8,-4.3],[39,8,-4.3]],.17,C.green);
            powerPipe(services,[[-2,4.5,-9.8],[-2,8.5,-9.8],[40,8.5,-9.8]],.16,C.metal);
            powerPipe(services,[[37.5,1.3,12.2],[38,1.3,12.2],[38,7.5,12.2],[38,7.5,5.8]],.18,C.blue);
            for(const [x,z,top] of [[29,-23,7.5],[-4,20.8,7.3],[25,14,8],[24.5,-4.3,8],[-2,-9.8,8.5],[38,12.2,7.5]]){post(services,x+.5,z,top,.16);box(services,x+.2,top-.03,z,.85,.12,.25,C.steel);for(let y=2.5;y<top;y+=2)box(services,x+.2,y,z,.85,.09,.12,C.steel);}
            const workbench=group(root,'power-maintenance-bay');box(workbench,-17,1.2,26,12,.2,2.7,C.metal);for(const x of [-22,-18,-14,-12])box(workbench,x,.6,26,.15,1.2,.15,C.steel);for(const x of [-21,-17,-13]){box(workbench,x,1.55,26,1.8,.5,1.1,C.blue);cyl(workbench,x,1.9,26,.22,.2,C.metal);}rail(root,-16,0,29,31);
        }
    }
    for(const def of PERSONNEL.filter(p=>p.view===view))registerPerson(person(root,def.x,def.z,def.x*.1),def);
    for(const {g,color,type,matrices} of batches.values()){
        const instance=new THREE.InstancedMesh(type==='box'?unitBox:type==='ring'?unitRing:unitCylinder,material(color),matrices.length);
        matrices.forEach((m,i)=>instance.setMatrixAt(i,m));instance.castShadow=true;instance.receiveShadow=true;instance.computeBoundingSphere();g.add(instance);
    }
    ZONES.filter(z=>z.view===view).forEach(markZone);
    root.userData.devices=devices;root.userData.people=people;root.userData.zones=zones;root.userData.view=view;root.userData.workerCount=people.length;
    return root;
}
