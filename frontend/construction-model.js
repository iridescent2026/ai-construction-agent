import * as THREE from 'three';
import {worldPoint,ringsOf,zoneBounds} from './scene-layout.mjs';

// Original procedural geometry. The footprint of each risk zone comes from GIS.
export function buildLandscape(features=[]) {
    const site=new THREE.Group();site.name='construction-site';
    const C={concrete:0xaab3b6,steel:0x677b85,gold:0xf6b644,earth:0x8e6548,blue:0x487d91,dark:0x243540,glass:0x4b94a3};
    const batches=new Map(),materials=new Map(),unit=new THREE.BoxGeometry(1,1,1),unitCylinder=new THREE.CylinderGeometry(1,1,1,10),dummy=new THREE.Object3D();
    function mat(color){if(!materials.has(color))materials.set(color,new THREE.MeshStandardMaterial({color,roughness:.78,metalness:color===C.steel?.35:.08}));return materials.get(color);}
    function part(id,title,text,anchor){const g=new THREE.Group();g.name=id;g.userData={kind:'model',id,title,text:`${text} 尺寸与构造为演示示意。`,anchor};site.add(g);return g;}
    function batch(g,color,type='box'){const key=g.uuid+':'+color+':'+type;if(!batches.has(key))batches.set(key,{g,color,type,matrices:[]});return batches.get(key).matrices;}
    function box(g,x,y,z,w,h,d,color,rotation=0){dummy.position.set(x,y,z);dummy.rotation.set(0,rotation,0);dummy.scale.set(w,h,d);dummy.updateMatrix();batch(g,color).push(dummy.matrix.clone());}
    function beam(g,a,b,width,color){const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),delta=end.clone().sub(start);dummy.position.copy(start.add(end).multiplyScalar(.5));dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.clone().normalize());dummy.scale.set(width,delta.length(),width);dummy.updateMatrix();batch(g,color).push(dummy.matrix.clone());}
    function mesh(g,geometry,color,x,y,z){const m=new THREE.Mesh(geometry,mat(color));m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;g.add(m);return m;}
    function cylinder(g,x,y,z,r,h,color,rotation=0){dummy.position.set(x,y,z);dummy.rotation.set(0,0,rotation);dummy.scale.set(r,h,r);dummy.updateMatrix();batch(g,color,'cylinder').push(dummy.matrix.clone());}
    function polygon(rings){const path=(ring,Type)=>{const p=new Type();ring.forEach(([lng,lat],i)=>{const [x,z]=worldPoint(lng,lat);i?p.lineTo(x,-z):p.moveTo(x,-z);});return p;};const s=path(rings[0],THREE.Shape);s.holes=rings.slice(1).map(r=>path(r,THREE.Path));return s;}

    const ground=part('yard','施工场地','场内道路、出入口与功能区布置。',[0,0,0]);
    const shape=new THREE.Shape();shape.moveTo(-355,-285);shape.lineTo(355,-285);shape.lineTo(355,285);shape.lineTo(-355,285);shape.closePath();
    for(const f of features.filter(f=>f.properties.zone_type==='基坑'))for(const rings of ringsOf(f)){const hole=new THREE.Path();rings[0].forEach(([lng,lat],i)=>{const [x,z]=worldPoint(lng,lat);i?hole.lineTo(x,-z):hole.moveTo(x,-z);});shape.holes.push(hole);}
    const yard=mesh(ground,new THREE.ShapeGeometry(shape),0x59676b,0,0,0);yard.rotation.x=-Math.PI/2;yard.castShadow=false;
    for(const x of [-315,315])box(ground,x,.08,0,34,.12,550,0x34434b);
    for(const z of [-251,251])box(ground,0,.09,z,650,.12,30,0x34434b);
    for(let z=-240;z<240;z+=27)for(const x of [-315,315])box(ground,x,.18,z,1.2,.1,12,0xd7d8cc);
    for(let x=-285;x<285;x+=30)for(const z of [-251,251])box(ground,x,.18,z,14,.1,1.2,0xd7d8cc);
    for(const z of [-235,235])box(ground,0,.2,z,630,.2,1.1,C.gold);
    for(const x of [-294,294])box(ground,x,.2,0,1.1,.2,467,C.gold);
    for(let z=239;z<264;z+=3.4)box(ground,95,.23,z,23,.12,1.8,0xdde0d6);
    const fence=part('perimeter','围挡与入口','围挡警示顶边、车辆入口、门岗与人行横道。',[95,13,279]);
    for(let x=-345;x<350;x+=14)for(const z of [-282,282]){if(z>0 && x>65 && x<120)continue;box(fence,x,6,z,13.5,12,1.1,C.blue);box(fence,x,12.6,z,14,1.2,1.8,C.gold);box(fence,x-7,6,z,1.2,13,1.8,C.steel);}
    for(let z=-275;z<280;z+=14)for(const x of [-352,352]){box(fence,x,6,z,1.1,12,13.5,C.blue);box(fence,x,12.6,z,1.8,1.2,14,C.gold);}
    box(fence,59,11,279,22,22,18,0xe2e0d2);box(fence,59,24,279,24,3,20,C.blue);box(fence,59,13,289,15,8,.5,C.glass);
    box(fence,93,11,279,47,2,2,C.gold);box(fence,69,5,279,2,10,2,C.gold);

    const building=part('building-a','A 栋 · 主体施工','楼板、柱梁框架、外脚手架、安全网与施工升降机。',[-205,85,-125]);
    const bx=-205,bz=-125;
    for(let floor=0;floor<6;floor++){
        const y=2+floor*13;box(building,bx,y,bz,105,2.5,85,C.concrete);
        for(const x of [-45,-15,15,45])for(const z of [-35,0,35])box(building,bx+x,y+6.5,bz+z,3.5,11,3.5,C.concrete);
        for(const z of [-35,0,35])box(building,bx,y+11.2,bz+z,96,2.6,3.5,C.concrete);
        if(floor<3){box(building,bx,y+5,bz-41,101,8.5,1.2,0xadb3b0);for(let w=-35;w<=35;w+=17)box(building,bx+w,y+5,bz-41.8,9,5,.8,C.glass);}
        for(let x=-58;x<=58;x+=14){cylinder(building,bx+x,y+6,bz+49,.55,13,C.steel);beam(building,[bx+x,y,bz+49],[bx+x+14,y+12,bz+49],.45,C.steel);}
        for(const z of [-49,49])for(const h of [y+3,y+9])box(building,bx,h,bz+z,124,.65,.65,C.gold);
        for(let x=-56;x<=56;x+=8)box(building,bx+x,y+6,bz+50,.55,10,.35,0x3b9e8c);
        for(let h=1;h<12;h+=2)box(building,bx,y+h,bz+50,118,.4,.35,0x3b9e8c);
        for(const x of [-58,58])for(let z=-46;z<48;z+=15)cylinder(building,bx+x,y+6,bz+z,.55,13,C.steel);
    }
    for(let i=0;i<8;i++)box(building,bx-23+i*6,4+i*1.25,bz+4,7,1.4,21,0x868f94);
    box(building,bx+53,38,bz+25,8,75,9,C.blue);box(building,bx+58,30,bz+25,11,14,13,C.gold);
    for(let x=-46;x<47;x+=13)for(const z of [-35,35])for(let i=0;i<3;i++)cylinder(building,bx+x+i*.8,77,bz+z,.22,18,0x806b57);

    const crane=part('tower-crane','T01 · 塔式起重机','格构塔身、回转平台、起重臂、配重、操作室与吊钩。',[-103,148,-132]);
    const cx=-103,cz=-133,cy=125;box(crane,cx,1,cz,23,3,23,C.concrete);
    for(const dx of [-4,4])for(const dz of [-4,4])box(crane,cx+dx,cy/2,cz+dz,1.3,cy,1.3,C.gold);
    for(let y=4;y<cy-6;y+=10){for(const z of [-4,4]){beam(crane,[cx-4,y,cz+z],[cx+4,y+10,cz+z],.75,C.gold);box(crane,cx,y,cz+z,9,.7,.7,C.gold);}for(const x of [-4,4])beam(crane,[cx+x,y,cz-4],[cx+x,y+10,cz+4],.75,C.gold);box(crane,cx+1,y,cz+4.6,3,.45,.45,0xead5a0);}
    cylinder(crane,cx,cy+1,cz,8,3,C.steel);box(crane,cx+7,cy-5,cz+7,11,11,9,C.gold);box(crane,cx+7,cy-3,cz+11.8,8,6,.5,C.glass);
    for(let x=-42;x<153;x+=10){for(const dz of [-3,3])beam(crane,[cx+x,cy+4,cz+dz],[cx+x+10,cy+4,cz+dz],.7,C.gold);beam(crane,[cx+x,cy+10,cz],[cx+x+10,cy+10,cz],.7,C.gold);beam(crane,[cx+x,cy+4,cz-3],[cx+x+10,cy+10,cz],.65,C.gold);beam(crane,[cx+x,cy+10,cz],[cx+x+10,cy+4,cz+3],.65,C.gold);}
    box(crane,cx-32,cy+1,cz,15,12,14,C.steel);beam(crane,[cx,cy+26,cz],[cx+146,cy+9,cz],.65,0xc6ccd0);beam(crane,[cx,cy+26,cz],[cx-40,cy+9,cz],.65,0xc6ccd0);box(crane,cx,cy+17,cz,2,20,2,C.gold);
    cylinder(crane,cx+112,cy-27,cz,.35,61,C.steel);box(crane,cx+112,cy-59,cz,5,5,4,C.gold);const hook=mesh(crane,new THREE.TorusGeometry(2.6,.65,6,12,Math.PI*1.65),C.dark,cx+112,cy-63,cz);hook.rotation.z=Math.PI;

    for(const f of features){
        const p=f.properties,b=zoneBounds(f);
        if(p.zone_type==='基坑'){
            const pit=part('pit-'+p.zone_id,`${p.zone_id} · 基坑支护`,'开挖土方、排桩、冠梁、十字内支撑、爬梯与坑边防护。',[b.x,3,b.minZ]);
            for(const rings of ringsOf(f)){
                const floor=mesh(pit,new THREE.ShapeGeometry(polygon(rings)),0x806448,0,-10,0);floor.rotation.x=-Math.PI/2;
                const ring=rings[0];
                for(let i=0;i<ring.length-1;i++){
                    const a=worldPoint(...ring[i]),c=worldPoint(...ring[i+1]),length=Math.hypot(c[0]-a[0],c[1]-a[1]);
                    const wall=mesh(pit,new THREE.BoxGeometry(length,10,1.6),0x7b8586,(a[0]+c[0])/2,-5,(a[1]+c[1])/2);wall.rotation.y=-Math.atan2(c[1]-a[1],c[0]-a[0]);
                    beam(pit,[a[0],.3,a[1]],[c[0],.3,c[1]],2.2,C.concrete);
                    for(let t=0;t<1;t+=3.2/length){const x=a[0]+(c[0]-a[0])*t,z=a[1]+(c[1]-a[1])*t;cylinder(pit,x,-4.7,z,1.1,9.6,C.concrete);box(pit,x,2,z,.65,4,.65,C.gold);}
                    for(const y of [1.9,3.8])beam(pit,[a[0],y,a[1]],[c[0],y,c[1]],.6,C.gold);
                }
            }
            for(const t of [.3,.7])beam(pit,[b.minX,-2.5,b.minZ+b.depth*t],[b.maxX,-2.5,b.minZ+b.depth*t],1.8,0x61847d);
            beam(pit,[b.x,-2.5,b.minZ],[b.x,-2.5,b.maxZ],1.8,0x61847d);
            for(let i=0;i<12;i++)box(pit,b.maxX-10,-9.5+i*.82,b.maxZ-4,4,.3,.7,C.gold);
            for(const x of [b.maxX-12,b.maxX-8])box(pit,x,-5,b.maxZ-4,.5,10,.5,C.gold);
            box(pit,b.minX+14,-9.5,b.minZ+13,14,1,8,0x5c6461);
        }else if(p.zone_type==='吊装区'){
            const pad=part('lifting-'+p.zone_id,`${p.zone_id} · 吊装作业区`,'地面作业区、预制构件与周边隔离警示。',[b.minX,2,b.minZ]);
            for(let t=.08;t<.96;t+=.13)box(pad,b.x,.12,b.minZ+b.depth*t,b.width-4,.13,.7,0xc2ad70);
            for(const x of [b.minX+2,b.maxX-2])for(let z=b.minZ;z<b.maxZ;z+=9){box(pad,x,1.4,z,.9,2.8,.9,C.gold);box(pad,x,2.6,z,4,.4,.6,0xde6e49);}
            for(let i=0;i<4;i++)box(pad,b.minX+12+i*4,1.8,b.minZ+13,3,3.6,18,C.concrete);
            box(pad,b.minX+17,2,b.minZ+31,18,4,9,C.steel);
            for(const x of [b.minX+10,b.minX+24])beam(pad,[x,5,b.minZ+28],[b.minX+17,16,b.minZ+31],.45,C.gold);
        }else if(p.zone_type==='高空区'){
            const frame=part('work-deck-'+p.zone_id,`${p.zone_id} · 高处作业平台`,'钢结构柱梁、分层平台、爬梯与周边护栏。',[b.x,42,b.minZ]);
            for(const x of [b.minX+5,b.x,b.maxX-5])for(const z of [b.minZ+5,b.maxZ-5])box(frame,x,18,z,2.2,36,2.2,C.steel);
            for(const y of [12,24,36]){for(const z of [b.minZ+5,b.maxZ-5]){box(frame,b.x,y,z,b.width-8,2,1.4,C.steel);box(frame,b.x,y+3.2,z,b.width-8,.5,.5,C.gold);}for(const x of [b.minX+5,b.maxX-5])box(frame,x,y,b.z,1.4,2,b.depth-8,C.steel);box(frame,b.x,y-.8,b.z,b.width-12,1,b.depth-12,0x9eaaa8);beam(frame,[b.minX+5,y-12,b.minZ+5],[b.minX+5,y,b.maxZ-5],.7,C.steel);}
            for(let y=1;y<35;y+=1.8)box(frame,b.minX+4,y,b.maxZ-7,4,.35,.8,C.gold);
        }
    }
    const offices=part('site-offices','项目部 · 临建办公区','双层装配房、外廊、楼梯与空调机组。',[187,32,-197]);
    for(let row=0;row<2;row++)for(let i=0;i<3;i++){const x=125+i*48,y=7+row*14,z=-192;box(offices,x,y,z,45,13,32,0xc4d3d4);box(offices,x,y+7,z,46,1.4,34,C.blue);for(let w=-14;w<=14;w+=14){box(offices,x+w,y+1,z+16.2,8,5,.7,C.glass);box(offices,x+w,y+1,z-16.2,8,5,.7,C.glass);}box(offices,x+17,y-2,z+16.3,6,9,.7,C.blue);box(offices,x+22,y,z-16.4,5,4,2,0x7b8b91);}
    box(offices,173,14,-169,147,1,12,C.concrete);box(offices,173,18,-162,147,.8,.8,C.gold);for(let x=105;x<245;x+=12)box(offices,x,16,-162,.5,4,.5,C.steel);for(let i=0;i<15;i++)box(offices,87,1+i*.9,-162-i*1.4,13,1,1.6,C.steel);
    const storage=part('material-yard','材料堆场','分区堆放管材、模板与预制构件。',[-204,14,168]);
    box(storage,-225,.18,156,150,.2,87,0x747d79);
    for(let row=0;row<3;row++)for(let i=0;i<8;i++)cylinder(storage,-262+i*3.4,1.7+row*2.8,150,1.45,43,0x8c989b,Math.PI/2);
    for(let k=0;k<3;k++)for(let j=0;j<6;j++)box(storage,-195+k*14,1+j*1.6,145,11,1.2,35,0x9a7852);
    for(let i=0;i<7;i++)box(storage,-250+i*8,1.2,185,5,2.4,25,C.concrete);
    const machines=part('machinery','工程机械 · 停放区','自卸车与履带挖掘机，静态展示。',[250,24,125]);
    box(machines,251,5,133,20,4,43,C.dark);box(machines,251,12,125,22,12,28,C.gold);box(machines,251,9,149,21,15,13,0xf2c458);box(machines,251,13,156,17,7,.5,C.glass);box(machines,239.9,13,149,.5,7,9,C.glass);
    for(const x of [239,263])for(const z of [115,131,149]){cylinder(machines,x,4,z,4,2.5,0x202b33,Math.PI/2);cylinder(machines,x,4,z,1.8,2.8,0x8d999c,Math.PI/2);}
    for(let z=115;z<138;z+=5)for(const x of [239.5,262.5])box(machines,x,12,z,.8,12,.8,0xdd9d32);
    for(const x of [206,228]){box(machines,x,3.5,189,6,6,26,0x293640);for(let z=179;z<201;z+=3)cylinder(machines,x,3.5,z,2.6,6,0x4c575c,Math.PI/2);}
    box(machines,217,8,189,20,7,19,C.gold);box(machines,209,16,191,10,13,14,C.dark);box(machines,208,17,199,8,8,.5,C.glass);
    beam(machines,[223,11,187],[245,31,187],4,C.gold);beam(machines,[245,31,187],[256,8,187],3,C.gold);beam(machines,[225,12,186],[241,23,186],1.1,C.steel);beam(machines,[242,28,186],[252,17,186],1,C.steel);box(machines,258,4,187,12,7,13,0x87755a);for(let z=182;z<194;z+=3)box(machines,264,2,z,4,1.2,1.2,C.steel);
    const services=part('site-services','场内设施','照明杆、消防点、设备防雨棚与绿化缓冲。',[272,12,-54]);
    for(const z of [-90,20,150]){cylinder(services,279,18,z,.65,36,C.steel);box(services,279,36,z,12,1.2,3,0xd7e3dd);}
    for(let i=0;i<5;i++){const x=-330+i*16,z=219;cylinder(services,x,6,z,1.1,12,0x846a4f);mesh(services,new THREE.IcosahedronGeometry(8,1),0x4c8070,x,17,z);}
    box(services,277,3,-54,8,6,5,0xb64943);box(services,277,7,-54,9,1.2,6,0xefe4ce);
    for(const [x,z] of [[-97,0],[48,-111]]){box(services,x,10,z,23,1.5,16,C.blue);for(const dx of [-10,10])for(const dz of [-6,6])box(services,x+dx,5,z+dz,.8,10,.8,C.steel);}
    for(const {g,color,type,matrices} of batches.values()){const material=['building-a','work-deck-Z003'].includes(g.name)?mat(color).clone():mat(color);const object=new THREE.InstancedMesh(type==='cylinder'?unitCylinder:unit,material,matrices.length);matrices.forEach((m,i)=>object.setMatrixAt(i,m));object.instanceMatrix.needsUpdate=true;object.computeBoundingSphere();object.castShadow=true;object.receiveShadow=true;g.add(object);}
    site.userData.parts=site.children.filter(c=>c.userData.kind==='model');return site;
}
