import json
import os
from shapely.geometry import Point, shape

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


# ============================================================
# 1. 从 GeoJSON 文件读取危险区域
# ============================================================
def load_zones_from_geojson(filepath):
    """从 GeoJSON 文件读取危险区域"""
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


# ============================================================
# 2. 核心函数：判断人员是否在危险区
# ============================================================
def check_person_in_danger(person_id, lng, lat, zones):
    """使用 GeoJSON 加载的区域判断"""
    point = Point(lng, lat)

    for zone in zones:
        polygon = zone["geometry"]

        if polygon.contains(point):
            return {
                "person_id": person_id,
                "inside_zone": True,
                "zone_id": zone["zone_id"],
                "zone_type": zone["zone_type"],
                "risk_level": zone["risk_level"],
                "alert": f"人员{person_id}进入{zone['zone_type']}危险区（{zone['risk_level']}风险）"
            }

    return {
        "person_id": person_id,
        "inside_zone": False,
        "zone_id": None,
        "zone_type": None,
        "risk_level": "低",
        "alert": f"人员{person_id}处于安全区域"
    }


# ============================================================
# 3. 测试
# ============================================================
if __name__ == "__main__":
    zones = load_zones_from_geojson(os.path.join(BASE_DIR, "danger_zones.geojson"))

    result1 = check_person_in_danger("P001", 120.1235, 30.4565, zones)
    print(json.dumps(result1, ensure_ascii=False, indent=2))

    result2 = check_person_in_danger("P003", 120.1300, 30.4600, zones)
    print(json.dumps(result2, ensure_ascii=False, indent=2))
