from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import json
import os
from shapely.geometry import Point, shape

app = FastAPI()

# CORS 配置：允许前端跨域调用
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


# ============================================================
# 数据加载
# ============================================================
def load_zones_from_geojson(filepath):
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)
    zones = []
    for feature in data["features"]:
        zones.append({
            "zone_id": feature["properties"]["zone_id"],
            "zone_type": feature["properties"]["zone_type"],
            "risk_level": feature["properties"]["risk_level"],
            "buffer_radius": feature["properties"].get("buffer_radius", 0.0001),
            "geometry": shape(feature["geometry"])
        })
    return zones


zones = load_zones_from_geojson(os.path.join(BASE_DIR, "danger_zones.geojson"))

# 模拟人员数据（与前端 app.js 对齐）
# P001在基坑Z001内，P002在吊装区Z002内，P004在高空区Z003内
all_people = [
    {"person_id": "P001", "lng": 120.008, "lat": 30.2945},
    {"person_id": "P002", "lng": 120.0100, "lat": 30.2935},
    {"person_id": "P003", "lng": 120.011, "lat": 30.292},
    {"person_id": "P004", "lng": 120.008, "lat": 30.2910},
    {"person_id": "P005", "lng": 120.006, "lat": 30.293},
]


# ============================================================
# 核心判断函数（含缓冲区）
# ============================================================
def check_person_in_danger(person_id, lng, lat, zones, buffer_distance=0.0001):
    point = Point(lng, lat)

    for zone in zones:
        polygon = zone["geometry"]

        # 在危险区内
        if polygon.contains(point):
            return {
                "person_id": person_id,
                "inside_zone": True,
                "in_buffer": False,
                "zone_id": zone["zone_id"],
                "zone_type": zone["zone_type"],
                "risk_level": zone["risk_level"],
                "alert": f"人员{person_id}进入{zone['zone_type']}危险区"
            }

        # 在缓冲区边缘
        distance = point.distance(polygon)
        if distance < buffer_distance:
            return {
                "person_id": person_id,
                "inside_zone": False,
                "in_buffer": True,
                "zone_id": zone["zone_id"],
                "zone_type": zone["zone_type"],
                "risk_level": zone["risk_level"],
                "distance_to_boundary": round(distance, 6),
                "alert": f"人员{person_id}靠近{zone['zone_type']}危险区，请注意"
            }

    return {
        "person_id": person_id,
        "inside_zone": False,
        "in_buffer": False,
        "zone_id": None,
        "zone_type": None,
        "risk_level": "低",
        "alert": f"人员{person_id}处于安全区域"
    }


# ============================================================
# 接口1：单人判断（含缓冲区）
# ============================================================
class PersonLocation(BaseModel):
    person_id: str
    lng: float
    lat: float


@app.post("/check_danger")
def check_danger(loc: PersonLocation):
    return check_person_in_danger(loc.person_id, loc.lng, loc.lat, zones)


# ============================================================
# 接口2：多人批量判断
# ============================================================
class BatchRequest(BaseModel):
    people: List[PersonLocation]


@app.post("/check_danger_batch")
def check_danger_batch(req: BatchRequest):
    results = []
    for person in req.people:
        result = check_person_in_danger(person.person_id, person.lng, person.lat, zones)
        results.append(result)
    return {"results": results}


# ============================================================
# 接口3：风险热力图数据
# ============================================================
@app.get("/risk_heatmap")
def risk_heatmap():
    heatmap_data = []
    for zone in zones:
        # 统计该区域内人数
        people_count = 0
        for person in all_people:
            point = Point(person["lng"], person["lat"])
            if zone["geometry"].contains(point):
                people_count += 1

        # 风险评分：高风险 + 人数多 = 评分高
        base_score = {"高": 0.8, "中": 0.5, "低": 0.2}.get(zone["risk_level"], 0.2)
        score = min(base_score + people_count * 0.05, 1.0)

        heatmap_data.append({
            "zone_id": zone["zone_id"],
            "zone_type": zone["zone_type"],
            "risk_level": zone["risk_level"],
            "people_count": people_count,
            "risk_score": round(score, 2)
        })

    return {"heatmap": heatmap_data}


# ============================================================
# 接口4：区域风险汇总
# ============================================================
@app.get("/zone_summary")
def zone_summary():
    summary = []
    for zone in zones:
        people_inside = []
        for person in all_people:
            point = Point(person["lng"], person["lat"])
            if zone["geometry"].contains(point):
                people_inside.append(person["person_id"])

        summary.append({
            "zone_id": zone["zone_id"],
            "zone_type": zone["zone_type"],
            "risk_level": zone["risk_level"],
            "people_count": len(people_inside),
            "people_list": people_inside
        })

    return {"zones": summary}
