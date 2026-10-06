// A shared coordinate transform for both GIS planes and the exterior model.
// Internal A/B placements are explicitly demonstration assumptions.
export function toLocal(site,[lng,lat]){return [(lng-site.origin[0])*111320*Math.cos(site.origin[1]*Math.PI/180),(site.origin[1]-lat)*111320];}
export function toGeo(site,[x,z]){return [site.origin[0]+x/(111320*Math.cos(site.origin[1]*Math.PI/180)),site.origin[1]-z/111320];}
export function placeEntity(site,view,x,z){const f=site.frames[view],c=Math.cos(f.rotation),s=Math.sin(f.rotation);return [f.translation[0]+f.scale*(c*x-s*z),f.translation[1]+f.scale*(s*x+c*z)];}
export function featurePoints(site,feature){const coords=feature.geometry.type==='Polygon'?feature.geometry.coordinates[0]:feature.geometry.type==='Point'?[feature.geometry.coordinates]:feature.geometry.coordinates;return coords.map(p=>toLocal(site,p));}
export function zoneFeature(site,info){const [x,z]=info.center,[w,d]=info.size;return {type:'Feature',properties:{...info},geometry:{type:'Polygon',coordinates:[[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2],[-w/2,-d/2]].map(([dx,dz])=>toGeo(site,placeEntity(site,info.view,x+dx,z+dz)))]}};}
export function pointInPolygon([x,z],ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,zi]=ring[i],[xj,zj]=ring[j];if(((zi>z)!==(zj>z))&&x<(xj-xi)*(z-zi)/(zj-zi)+xi)inside=!inside;}return inside;}
export function clipSegment(a,b,bounds){const [xmin,zmin,xmax,zmax]=bounds,dx=b[0]-a[0],dz=b[1]-a[1];let t0=0,t1=1;const p=[-dx,dx,-dz,dz],q=[a[0]-xmin,xmax-a[0],a[1]-zmin,zmax-a[1]];for(let i=0;i<4;i++){if(p[i]===0){if(q[i]<0)return null;continue;}const r=q[i]/p[i];if(p[i]<0)t0=Math.max(t0,r);else t1=Math.min(t1,r);if(t0>t1)return null;}return [[a[0]+t0*dx,a[1]+t0*dz],[a[0]+t1*dx,a[1]+t1*dz]];}
