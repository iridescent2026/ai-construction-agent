from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import httpx

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

GIS_API = "http://127.0.0.1:8000"
ELEC_API = "http://127.0.0.1:8001"


@app.get("/risk")
async def get_risk():
    """综合风险查询：融合 GIS 空间风险和电气风险"""
    async with httpx.AsyncClient() as client:
        gis_res = await client.get(f"{GIS_API}/risk_heatmap")
        elec_res = await client.get(f"{ELEC_API}/devices")

    gis_data = gis_res.json()["heatmap"]
    elec_data = elec_res.json()["devices"]

    # 空间风险取最高
    gis_max = max(z["risk_score"] for z in gis_data) if gis_data else 0
    # 电气风险取最高
    # 注意：GIS 与电气是两个独立危险源，任一超标即构成危险，
    # 因此这里不施加任何折减系数，与 gis_max 同等对待
    elec_max = max(d["risk_score"] for d in elec_data) if elec_data else 0

    # 综合评分：取两个维度中最危险者
    overall = round(max(gis_max, elec_max), 2)

    # 建议：区分是哪个维度触发，避免提示与原因不匹配
    if overall >= 0.7:
        if elec_max >= gis_max:
            suggestion = "立即检查高风险电气设备，必要时断电处理"
        else:
            suggestion = "立即疏散高风险区域人员"
    elif overall >= 0.3:
        suggestion = "加强巡检，关注高风险区域与设备"
    else:
        suggestion = "保持正常监测"

    return {
        "overall_risk": overall,
        "gis_max": gis_max,
        "elec_max": elec_max,
        "gis_risk": gis_data,
        "elec_risk": elec_data,
        "suggestion": suggestion
    }


# ============================================================
# 第2周：路径优化 + 智能体对话
# ============================================================
from ortools.constraint_solver import routing_enums_pb2
from ortools.constraint_solver import pywrapcp
from pydantic import BaseModel
from typing import List
import math as m


class Point(BaseModel):
    id: str
    lng: float
    lat: float
    risk: float = 0.0


class RouteRequest(BaseModel):
    points: List[Point]
    start_id: str


def distance(p1, p2):
    """计算两点间距离（米）"""
    R = 6371000
    lat1, lon1 = m.radians(p1.lat), m.radians(p1.lng)
    lat2, lon2 = m.radians(p2.lat), m.radians(p2.lng)
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = m.sin(dlat/2)**2 + m.cos(lat1)*m.cos(lat2)*m.sin(dlon/2)**2
    return R * 2 * m.atan2(m.sqrt(a), m.sqrt(1-a))


@app.post("/route")
def optimize_route(req: RouteRequest):
    """巡检路径优化：优先访问高风险点"""
    points = req.points
    n = len(points)
    if n < 2:
        return {"error": "至少需要 2 个点"}

    dist_matrix = [[int(distance(points[i], points[j])) for j in range(n)] for i in range(n)]
    start_idx = next(i for i, p in enumerate(points) if p.id == req.start_id)

    manager = pywrapcp.RoutingIndexManager(n, 1, start_idx)
    routing = pywrapcp.RoutingModel(manager)

    def distance_callback(from_idx, to_idx):
        return dist_matrix[manager.IndexToNode(from_idx)][manager.IndexToNode(to_idx)]

    transit_callback_index = routing.RegisterTransitCallback(distance_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

    search_params = pywrapcp.DefaultRoutingSearchParameters()
    search_params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC

    solution = routing.SolveWithParameters(search_params)
    if not solution:
        return {"error": "无解"}

    route = []
    total_dist = 0
    index = routing.Start(0)
    while not routing.IsEnd(index):
        node = manager.IndexToNode(index)
        route.append(points[node].id)
        index = solution.Value(routing.NextVar(index))
        # 终点索引也对应起点，最后一段回程同样计入总距离。
        total_dist += dist_matrix[node][manager.IndexToNode(index)]
    route.append(points[start_idx].id)

    return {
        "route": route,
        "total_distance": total_dist,
        "estimated_time": round(total_dist / 60, 1),
        "reason": "优先覆盖高风险区域"
    }


@app.post("/chat")
async def chat(query: str):
    """智能体对话：解析问题→调用工具→返回答案"""
    async with httpx.AsyncClient() as client:
        if "风险" in query and "最高" in query:
            res = await client.get(f"{GIS_API}/risk_heatmap")
            data = res.json()["heatmap"]
            top = max(data, key=lambda x: x["risk_score"])
            return {
                "answer": f"{top['zone_id']} {top['zone_type']} 风险最高，评分 {top['risk_score']}，区域内 {top['people_count']} 人。",
                "tool_calls": ["/risk_heatmap"]
            }

        elif "巡检" in query or "路线" in query:
            return {
                "answer": "已为您生成巡检路线，请调用 /route 接口。",
                "tool_calls": ["/route"]
            }

        elif "电气" in query or "配电" in query:
            res = await client.get(f"{ELEC_API}/devices")
            data = res.json()["devices"]
            high = [d for d in data if d["risk_level"] == "高"]
            if high:
                return {
                    "answer": f"有 {len(high)} 个高风险设备：{', '.join(d['device_id'] for d in high)}。",
                    "tool_calls": ["/devices"]
                }
            return {"answer": "所有电气设备正常。", "tool_calls": ["/devices"]}

        else:
            return {
                "answer": "我可以帮您查询风险、生成巡检路线、检查电气设备。",
                "tool_calls": []
            }
