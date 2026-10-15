import * as THREE from 'three';
const offsets=new WeakMap();
// Cache a point in object-local space. Moving/rotating any ancestor then moves
// the marker with the rendered object, including scaled worker models.
export function modelMarkerAnchor(root,info){
 const object=root?.getObjectByName(info.id);
 if(!object)return info.anchor;
 object.updateWorldMatrix(true,true);
 let local=offsets.get(object);
 if(!local){const bounds=new THREE.Box3().setFromObject(object);if(bounds.isEmpty())return info.anchor;local=bounds.getCenter(new THREE.Vector3());local.y=bounds.max.y+.18;object.worldToLocal(local);offsets.set(object,local);}
 return object.localToWorld(local.clone()).toArray();
}
