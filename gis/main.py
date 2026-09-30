from fastapi import FastAPI
from pydantic import BaseModel
import json
import os
from shapely.geometry import Point, shape

app = FastAPI()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def load_zones_from_geojson(filepath):
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)
    zones = []
    for feature in data["features"]:
        zones.append({
            "zone_id": feature["properties"]["zone_id"],
            "zone_type": feature["properties"]["zone_type"],
            "risk_level": feature["properties"]["risk_level"],
            "geometry": shape(feature["geometry"])
        })
    return zones

zones = load_zones_from_geojson(os.path.join(BASE_DIR, "danger_zones.geojson"))

class PersonLocation(BaseModel):
    person_id: str
    lng: float
    lat: float

@app.post("/check_danger")
def check_danger(loc: PersonLocation):
    point = Point(loc.lng, loc.lat)
    for zone in zones:
        if zone["geometry"].contains(point):
            return {
                "person_id": loc.person_id,
                "inside_zone": True,
                "zone_id": zone["zone_id"],
                "zone_type": zone["zone_type"],
                "risk_level": zone["risk_level"],
                "alert": f"人员{loc.person_id}进入{zone['zone_type']}危险区"
            }
    return {
        "person_id": loc.person_id,
        "inside_zone": False,
        "zone_id": None,
        "zone_type": None,
        "risk_level": "低",
        "alert": f"人员{loc.person_id}处于安全区域"
    }
