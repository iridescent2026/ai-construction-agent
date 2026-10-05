import * as THREE from 'three';

// Procedural scenery only: never used as surveyed geometry or routing obstacles.
export function buildLandscape(){
    const site=new THREE.Group();
    function box(x,y,z,w,h,d,color){
        const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color,roughness:.78,metalness:.2}));
        m.position.set(x,y,z);site.add(m);return m;
    }
    function beam(a,b,width,color){
        const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),delta=end.clone().sub(start);
        const m=box(...start.clone().add(end).multiplyScalar(.5).toArray(),width,delta.length(),width,color);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());
    }
    // Perimeter and service lanes.
    box(0,-2,0,700,3,560,0x26383e);
    for(const x of [-315,315])box(x,.1,0,30,.3,500,0x142128);
    for(const z of [-245,245])box(0,.1,z,660,.3,30,0x142128);
    for(let n=-280;n<=280;n+=35)for(const z of [-245,245])box(n,.4,z,15,.2,1.2,0xeac478);
    for(let x=-345;x<=345;x+=15)for(const z of [-278,278]){box(x,6,z,14,12,1.5,0x637e89);box(x,13,z,14,1,2,0xefb64e);}
    for(let z=-265;z<=265;z+=15)for(const x of [-348,348])box(x,6,z,1.5,12,14,0x637e89);
    // Reinforced concrete frame, individual columns and floor slabs.
    for(let floor=0;floor<5;floor++){
        const y=3+floor*17;
        box(-190,y,-155,104,3,70,0x8a9a9f);
        if(floor<4)for(const x of [-235,-205,-175,-145])for(const z of [-182,-128])box(x,y+9,z,4,15,4,0x697b83);
        if(floor>1)box(-190,y+7,-189,100,11,1,0x3a746f);
    }
    // Tower crane lattice mast, jib, counterweight and suspended hook.
    const cx=-105,cz=-170,gold=0xe9ae36;
    for(const dx of [-4,4])for(const dz of [-4,4])box(cx+dx,55,cz+dz,1.6,110,1.6,gold);
    for(let y=4;y<108;y+=12){beam([cx-4,y,cz-4],[cx+4,y+12,cz-4],1,gold);beam([cx+4,y,cz+4],[cx-4,y+12,cz+4],1,gold);}
    box(cx+38,111,cz,130,3,5,gold);box(cx-24,107,cz,14,9,10,0x526a75);box(cx+5,106,cz+6,10,8,9,0x43b8c3);
    beam([cx,130,cz],[cx+102,112,cz],.8,0x9fb5c0);beam([cx,130,cz],[cx-28,112,cz],.8,0x9fb5c0);
    box(cx,120,cz,2,22,2,gold);box(cx+77,81,cz,.6,60,.6,0xb5c3c9);box(cx+77,50,cz,4,3,4,gold);
    // Site offices and material storage.
    for(let i=0;i<3;i++){
        const x=130+i*48;box(x,10,-190,42,20,28,0x54778b);box(x,21,-190,44,2,30,0xc9d2cf);
        for(let j=-1;j<=1;j++)box(x+j*11,12,-175,7,7,.5,0x152d3f);
        box(x+13,6,-175,5,12,.6,0xf1b75b);
    }
    for(let i=0;i<5;i++)box(180+i*13,4,195,10,8,30,0xab8460);
    // Parked construction truck and excavator; intentionally static.
    box(250,8,135,18,13,34,0xd8a13e);box(250,8,158,18,15,13,0xefc04c);box(250,11,165,14,6,1,0x193b4c);
    for(const x of [239,261])for(const z of [127,151])box(x,4,z,4,8,8,0x111c25);
    box(-240,5,175,25,8,20,0x16262e);box(-240,13,175,20,10,16,0xe7aa39);box(-246,22,175,10,12,13,0x396877);
    beam([-232,17,175],[-217,36,175],4,gold);beam([-217,36,175],[-199,10,175],3,gold);box(-196,5,175,12,6,13,gold);
    return site;
}
