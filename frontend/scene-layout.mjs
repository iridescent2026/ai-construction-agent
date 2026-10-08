// Heights illustrate construction only; plan positions use the shared map frame.
export function worldPoint(lng, lat) {
    return [(lng - 120.008) * 111320 * Math.cos(30.293 * Math.PI / 180), -(lat - 30.293) * 111320];
}
export function ringsOf(f) { return f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates]; }
export function zoneBounds(f) {
    const points=ringsOf(f).flatMap(rings=>rings[0].map(p=>worldPoint(...p)));
    const xs=points.map(p=>p[0]),zs=points.map(p=>p[1]);
    const minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
    return {minX,maxX,minZ,maxZ,width:maxX-minX,depth:maxZ-minZ,x:(minX+maxX)/2,z:(minZ+maxZ)/2};
}
function inRing(x,z,ring) {
    let inside=false;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){
        const [xi,zi]=worldPoint(...ring[i]),[xj,zj]=worldPoint(...ring[j]);
        if(((zi>z)!==(zj>z)) && x<(xj-xi)*(z-zi)/(zj-zi)+xi)inside=!inside;
    }
    return inside;
}
export function surfaceHeight(lng,lat,features=[]) {
    const [x,z]=worldPoint(lng,lat);
    return features.some(f=>f.properties.zone_type==='基坑' && ringsOf(f).some(rings=>inRing(x,z,rings[0]) && !rings.slice(1).some(hole=>inRing(x,z,hole))))?-10:0;
}
export function placeLabels(items,width,height,top=66,bottom=45) {
    const placed=[],positions=new Map();
    for(const item of [...items].sort((a,b)=>b.priority-a.priority || a.id.localeCompare(b.id))){
        if(!item.visible || item.x< -30 || item.x>width+30 || item.y<0 || item.y>height)continue;
        const sx=item.width+8,sy=item.height+7;
        for(const [dx,dy] of [[0,-sy],[0,-sy*2],[0,6],[-sx,-sy],[sx,-sy],[-sx,6],[sx,6],[0,-sy*3],[0,sy+6],[-sx,-sy*2],[sx,-sy*2]]){
            const left=Math.max(5,Math.min(width-item.width-5,item.x-item.width/2+dx)),y=item.y+dy;
            const rect={left,top:y,right:left+item.width,bottom:y+item.height};
            if(rect.top<top || rect.bottom>height-bottom)continue;
            if(placed.some(r=>rect.left<r.right+4 && rect.right+4>r.left && rect.top<r.bottom+4 && rect.bottom+4>r.top))continue;
            placed.push(rect);positions.set(item.id,{x:left,y});break;
        }
    }
    return positions;
}
