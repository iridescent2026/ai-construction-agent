import * as THREE from 'three';
import {placeEntity} from './gis-reference-geometry.mjs';

const paint={unknown:0x87959d,danger:0xeb6657,clear:0x55c3a5};
function box(group,size,pos,color){const m=new THREE.Mesh(new THREE.BoxGeometry(...size),new THREE.MeshStandardMaterial({color,roughness:.72,metalness:.35}));m.position.set(...pos);group.add(m);return m;}
function worker(){const g=new THREE.Group();box(g,[.7,.8,.4],[0,1.1,0],0xe8ad40);box(g,[.62,.15,.45],[0,1.05,.02],0xe1e9de);for(const x of [-.19,.19])box(g,[.23,.66,.25],[x,.36,0],0x384753);const head=new THREE.Mesh(new THREE.SphereGeometry(.26,10,8),new THREE.MeshStandardMaterial({color:0xdcbba0}));head.position.y=1.8;g.add(head);const helmet=new THREE.Mesh(new THREE.SphereGeometry(.31,12,8,0,Math.PI*2,0,Math.PI/2),new THREE.MeshStandardMaterial({color:0xedb73c}));helmet.position.y=1.87;g.add(helmet);const ring=new THREE.Mesh(new THREE.TorusGeometry(.7,.06,6,24),new THREE.MeshBasicMaterial({color:paint.clear}));ring.rotation.x=Math.PI/2;ring.position.y=.06;g.add(ring);g.userData.ring=ring;return g;}

export class OutdoorActors {
    constructor(parent,onSelect,transform=(e)=>[e.anchor[0],e.anchor[2]]){this.parent=parent;this.onSelect=onSelect;this.transform=transform;this.root=new THREE.Group();parent.add(this.root);this.items=new Map();}
    update(data,offline,visibility={}){const seen=new Set();for(const e of data?.entities||[]){if(e.view!=='overview'||e.kind==='device'&&!e.mobile)continue;seen.add(e.id);let node=this.items.get(e.id);
        if(!node){node=e.kind==='person'?worker():e.kind==='zone'?new THREE.Group():new THREE.Group();if(e.kind==='zone'){const m=new THREE.Mesh(new THREE.BoxGeometry(e.size[0],.1,e.size[1]),new THREE.MeshBasicMaterial({color:0xed6e57,transparent:true,opacity:.19,depthWrite:false}));node.add(m);}if(e.kind==='device')box(node,[3.8,1.6,1.7],[0,.9,0],0xd49c3a);node.name=e.id;this.items.set(e.id,node);this.root.add(node);}
        node.userData.info=e;node.visible=visibility[e.kind]!==false;if(e.kind==='zone'){node.scale.setScalar(this.transform.scale||1);node.rotation.y=-(this.transform.rotation||0);}const p=this.transform(e);node.position.set(p[0],0,p[1]);const level=offline?'unknown':e.riskState||'clear';if(node.userData.ring)node.userData.ring.material.color.setHex(paint[level]||paint.unknown);
    }for(const [id,node] of this.items)if(!seen.has(id)){this.root.remove(node);this.items.delete(id);}}
    locate(id){return this.items.get(id)?.position;}
}

export const referenceTransform=site=>Object.assign(e=>placeEntity(site,'overview',...(e.kind==='zone'?e.center:[e.anchor[0],e.anchor[2]])),{scale:site.frames.overview.scale,rotation:site.frames.overview.rotation});
