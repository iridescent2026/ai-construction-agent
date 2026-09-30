from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import random
from datetime import datetime

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# 模拟电气设备数据
# ============================================================
devices = [
    {
        "device_id": "D001",
        "device_type": "配电箱",
        "location": [120.007, 30.293],
        "load": 35,
        "temperature": 45,
        "leakage": 0.1
    },
    {
        "device_id": "D002",
        "device_type": "配电箱",
        "location": [120.008, 30.294],
        "load": 85,
        "temperature": 62,
        "leakage": 0.3
    },
    {
        "device_id": "D003",
        "device_type": "开关柜",
        "location": [120.009, 30.293],
        "load": 45,
        "temperature": 50,
        "leakage": 0.2
    },
    {
        "device_id": "D004",
        "device_type": "配电箱",
        "location": [120.007, 30.292],
        "load": 15,
        "temperature": 40,
        "leakage": 0.1
    }
]


# ============================================================
# 风险评分模型
# ============================================================
def calc_risk_score(load, temperature, leakage):
    """计算电气风险评分 0-1"""
    risk = 0
    risk += min(load / 100, 1.0) * 0.4
    risk += min(temperature / 80, 1.0) * 0.3
    risk += min(leakage / 0.5, 1.0) * 0.3
    return round(min(risk, 1.0), 2)


def get_risk_level(score):
    """风险等级映射"""
    if score >= 0.7:
        return "高"
    if score >= 0.3:
        return "中"
    return "低"


def get_alert(load, temperature, leakage, score):
    """生成预警文字"""
    alerts = []
    if load > 80:
        alerts.append("过载")
    if temperature > 60:
        alerts.append("高温")
    if leakage > 0.3:
        alerts.append("漏电")
    if not alerts:
        return "正常"
    return "、".join(alerts)


# ============================================================
# 动态数据模拟
# ============================================================
def simulate_device_data(device):
    """模拟设备数据波动"""
    d = device.copy()
    d["load"] = min(max(d["load"] + random.randint(-10, 10), 0), 100)
    d["temperature"] = min(max(d["temperature"] + random.randint(-5, 5), 20), 100)
    d["leakage"] = round(max(d["leakage"] + random.uniform(-0.1, 0.1), 0), 2)
    d["timestamp"] = datetime.now().isoformat()
    return d


def build_device_response(d):
    """统一构造设备响应（含动态数据+风险评分）"""
    simulated = simulate_device_data(d)
    score = calc_risk_score(simulated["load"], simulated["temperature"], simulated["leakage"])
    record_history(d["device_id"], score)
    return {
        **simulated,
        "risk_score": score,
        "risk_level": get_risk_level(score),
        "alert": get_alert(simulated["load"], simulated["temperature"], simulated["leakage"], score)
    }


# ============================================================
# 风险历史记录
# ============================================================
history = {d["device_id"]: [] for d in devices}


def record_history(device_id, score):
    history[device_id].append({
        "timestamp": datetime.now().isoformat(),
        "risk_score": score
    })
    history[device_id] = history[device_id][-20:]


# ============================================================
# 接口1：GET /devices — 所有设备状态（动态数据）
# ============================================================
@app.get("/devices")
def get_devices():
    result = [build_device_response(d) for d in devices]
    return {"devices": result}


# ============================================================
# 接口2：GET /devices/{device_id} — 单设备详情（动态数据）
# ============================================================
@app.get("/devices/{device_id}")
def get_device(device_id: str):
    for d in devices:
        if d["device_id"] == device_id:
            return build_device_response(d)
    return {"error": "设备不存在"}


# ============================================================
# 接口3：POST /devices/batch — 批量查询
# ============================================================
class BatchRequest(BaseModel):
    device_ids: List[str]


@app.post("/devices/batch")
def get_devices_batch(req: BatchRequest):
    results = []
    for device_id in req.device_ids:
        for d in devices:
            if d["device_id"] == device_id:
                results.append(build_device_response(d))
    return {"devices": results}


# ============================================================
# 接口4：GET /devices/{device_id}/history — 风险历史记录
# ============================================================
@app.get("/devices/{device_id}/history")
def get_device_history(device_id: str):
    if device_id not in history:
        return {"error": "设备不存在"}
    return {"device_id": device_id, "history": history[device_id]}


# ============================================================
# 接口5：GET /devices.geojson — GeoJSON 导出
# ============================================================
@app.get("/devices.geojson")
def devices_geojson():
    features = []
    for d in devices:
        score = calc_risk_score(d["load"], d["temperature"], d["leakage"])
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": d["location"]
            },
            "properties": {
                "device_id": d["device_id"],
                "device_type": d["device_type"],
                "risk_score": score,
                "risk_level": get_risk_level(score)
            }
        })
    return {"type": "FeatureCollection", "features": features}
