import json,math
from pathlib import Path
from shapely.geometry import shape,mapping,Polygon,box,LineString
from shapely.ops import unary_union
repo=Path(__file__).resolve().parents[1]
folder=repo/'frontend/assets/factory'
site=json.loads((folder/'reference-site.json').read_text(encoding='utf-8'))
layout=json.loads((folder/'reference-site.geojson').read_text(encoding='utf-8'))
k=111320*math.cos(math.radians(site['origin'][1]))
def local(p):return [(p[0]-site['origin'][0])*k,(site['origin'][1]-p[1])*111320]
def geo(p):return [site['origin'][0]+p[0]/k,site['origin'][1]-p[1]/111320]
def polygon(f):return Polygon([local(p) for p in f['geometry']['coordinates'][0]])
buildings=unary_union([polygon(f) for f in layout['features'] if f['properties']['kind']=='building'])
roads=unary_union([LineString([local(p) for p in f['geometry']['coordinates']]).buffer(f['properties'].get('width',6)/2,cap_style=1,join_style=1) for f in layout['features'] if f['properties']['kind']=='road'])
w,s,e,n=site['bounds'];lo=local([w,n]);hi=local([e,s]);site_clip=box(lo[0],lo[1],hi[0],hi[1])
boundary=polygon(next(f for f in layout['features'] if f['properties']['kind']=='boundary'))
bx,bz,xx,zz=boundary.bounds
clip=box(bx-18,bz-18,xx+18,zz+18).intersection(site_clip)
roads=roads.intersection(clip).difference(buildings.buffer(.35)).simplify(.18,preserve_topology=True)
features=[f for f in layout['features'] if f['properties']['kind'] not in ['road','gate','yard']]
for i,p in enumerate([roads] if roads.geom_type=='Polygon' else roads.geoms):
    if p.area<1:continue
    # Split holes into triangles only where necessary is handled by the renderers;
    # retain all rings so pavement cannot fill over buildings.
    coords=[[geo(q) for q in ring.coords] for ring in [p.exterior,*p.interiors]]
    features.append({'type':'Feature','properties':{'id':f'ROAD-{i+1}','kind':'road','title':'厂区与周边通道','basis':'derived-layout','source':'OpenStreetMap / Esri imagery reference','note':'合并重复路段并避让建筑轮廓，仅为演示平面。'},'geometry':{'type':'Polygon','coordinates':coords}})
for f in layout['features']:
    if f['properties']['kind']!='yard':continue
    yard=polygon(f).difference(buildings.buffer(.35)).difference(roads)
    for i,p in enumerate([yard] if yard.geom_type=='Polygon' else yard.geoms):
        if p.area<1:continue
        features.append({'type':'Feature','properties':{**f['properties'],'id':f['properties']['id']+f'-{i}'},'geometry':{'type':'Polygon','coordinates':[[geo(q) for q in ring.coords] for ring in [p.exterior,*p.interiors]]}})
(folder/'factory-plan.geojson').write_text(json.dumps({'type':'FeatureCollection','contextBounds':list(clip.bounds),'features':features},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
footprints={}
for f in layout['features']:
    view=f['properties'].get('workArea')
    if not view:continue
    frame=site['frames'][view];c=math.cos(frame['rotation']);s=math.sin(frame['rotation']);points=[]
    for p in f['geometry']['coordinates'][0]:
        x,z=local(p);x-=frame['translation'][0];z-=frame['translation'][1]
        points.append([round((c*x+s*z)/frame['scale'],6),round((-s*x+c*z)/frame['scale'],6)])
    footprints[view]=points
(repo/'frontend/factory-footprints.mjs').write_text('// Scene-local footprint derived from reference-site.geojson and its shared frames.\n// Tests verify correspondence with the public exterior reference.\nexport const FOOTPRINTS='+json.dumps(footprints,separators=(',',':'))+';\n',encoding='utf-8')
print('Built non-overlapping pavement, yard polygons and matching A/B floor outlines.')
