"""固定点集比较权重 5 和 0；先启动数学服务，无需额外 Python 包。"""
import json
import sys
from urllib.request import Request, urlopen

POINTS = [
    {"id": "S", "lng": 120.006, "lat": 30.293, "risk": 0},
    {"id": "L1", "lng": 120.008, "lat": 30.293, "risk": 0.01},
    {"id": "H", "lng": 120.008, "lat": 30.295, "risk": 0.99},
    {"id": "L2", "lng": 120.006, "lat": 30.295, "risk": 0.01},
]


def compare_routes():
    plans = []
    for weight in (5, 0):
        payload = {"points": POINTS, "start_id": "S", "risk_priority_weight": weight}
        request = Request("http://127.0.0.1:8002/route", data=json.dumps(payload).encode(),
                          headers={"Content-Type": "application/json"}, method="POST")
        with urlopen(request, timeout=8) as response:
            plans.append(json.load(response))
    return {"points": POINTS, "plans": plans}


if __name__ == "__main__":
    # 包含输入快照和完整输出，便于独立复核距离、访问顺序及优化代价。
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(compare_routes(), ensure_ascii=False, indent=2))
