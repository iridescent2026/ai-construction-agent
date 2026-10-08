"""WGS84 inputs; per-zone local metric projection shared by checks and display."""
import json
from functools import lru_cache
from pyproj import CRS, Transformer
from shapely.geometry import Point, shape, mapping
from shapely.ops import transform


def load_zones_from_geojson(filepath):
    with open(filepath, encoding="utf-8") as stream:
        data = json.load(stream)
    return [{**f["properties"], "buffer_radius": float(f["properties"].get("buffer_radius", 5)),
             "geometry": shape(f["geometry"])} for f in data["features"]]


@lru_cache(maxsize=128)
def projectors(lng, lat):
    crs = CRS.from_proj4(f"+proj=aeqd +lat_0={lat} +lon_0={lng} +datum=WGS84 +units=m")
    return (Transformer.from_crs("EPSG:4326", crs, always_xy=True).transform,
            Transformer.from_crs(crs, "EPSG:4326", always_xy=True).transform)


def metric_zone(zone):
    center = zone["geometry"].centroid
    forward, inverse = projectors(center.x, center.y)
    return transform(forward, zone["geometry"]), forward, inverse


def zone_geojson(zones, buffers=False):
    features = []
    for zone in zones:
        geometry = zone["geometry"]
        if buffers:
            polygon, _, inverse = metric_zone(zone)
            geometry = transform(inverse, polygon.buffer(zone["buffer_radius"], quad_segs=32))
        features.append({"type": "Feature", "geometry": mapping(geometry),
                         "properties": {k: v for k, v in zone.items() if k != "geometry"}})
    return {"type": "FeatureCollection", "features": features}


def check_person_in_danger(person_id, lng, lat, zones, buffer_distance=None):
    """All matches, sorted by severity, interior then stable ID. Boundaries count inside.

    buffer_distance is an optional override IN METRES; default uses each zone's configuration.
    """
    point = Point(lng, lat)
    matches = []
    for zone in zones:
        polygon, forward, _ = metric_zone(zone)
        projected_point = transform(forward, point)
        # Test original geometry so projecting long edges cannot change boundary ownership.
        inside = zone["geometry"].covers(point)
        distance = 0.0 if inside else projected_point.distance(polygon)
        radius = zone.get("buffer_radius", 5) if buffer_distance is None else buffer_distance
        if inside or distance <= radius + 1e-7:
            matches.append({"zone_id": zone["zone_id"], "zone_type": zone["zone_type"],
                            "risk_level": zone["risk_level"], "inside_zone": inside,
                            "in_buffer": not inside, "distance_to_boundary": round(distance, 3),
                            "distance_unit": "m", "buffer_radius": radius})
    matches.sort(key=lambda x: (-{"高": 3, "中": 2, "低": 1}.get(x["risk_level"], 0),
                                not x["inside_zone"], x["zone_id"]))
    if matches:
        primary = matches[0]
        action = "进入" if primary["inside_zone"] else "靠近"
        return {"person_id": person_id, **primary, "matches": matches,
                "alert": f"人员{person_id}{action}{primary['zone_type']}危险区（{primary['risk_level']}风险）"}
    return {"person_id": person_id, "inside_zone": False, "in_buffer": False,
            "zone_id": None, "zone_type": None, "risk_level": "低", "matches": [],
            "distance_unit": "m", "alert": f"人员{person_id}未命中已配置危险区"}
