import json
import math
from pathlib import Path
from shapely.geometry import shape, box
from shapely.ops import transform, unary_union

FOLDER=Path(__file__).resolve().parents[1]/'frontend/assets/factory'
SITE=json.loads((FOLDER/'reference-site.json').read_text(encoding='utf-8'))
PLAN=json.loads((FOLDER/'factory-plan.geojson').read_text(encoding='utf-8'))


def local_geometry(feature):
    longitude, latitude=SITE['origin']
    scale=111320*math.cos(math.radians(latitude))
    return transform(lambda x,y:((x-longitude)*scale,(latitude-y)*111320),shape(feature['geometry']))


def test_plan_roads_and_yards_do_not_overlap_buildings_or_each_other():
    buildings=unary_union([local_geometry(f) for f in PLAN['features'] if f['properties']['kind']=='building'])
    roads=[local_geometry(f) for f in PLAN['features'] if f['properties']['kind']=='road']
    yards=[local_geometry(f) for f in PLAN['features'] if f['properties']['kind']=='yard']
    assert roads
    for index, road in enumerate(roads):
        assert road.is_valid
        assert road.intersection(buildings).area<.00001
        for other in roads[index+1:]:
            assert road.intersection(other).area<.00001
    for yard in yards:
        assert yard.is_valid
        assert yard.intersection(buildings).area<.00001
        assert yard.intersection(unary_union(roads)).area<.00001


def test_plan_preserves_original_buildings_and_fits_its_context_plate():
    original=json.loads((FOLDER/'reference-site.geojson').read_text(encoding='utf-8'))
    for kind in ['building','boundary']:
        assert [f for f in PLAN['features'] if f['properties']['kind']==kind]==[f for f in original['features'] if f['properties']['kind']==kind]
    context=box(*PLAN['contextBounds']).buffer(.00001)
    for feature in PLAN['features']:
        assert context.covers(local_geometry(feature)),feature['properties']['id']
