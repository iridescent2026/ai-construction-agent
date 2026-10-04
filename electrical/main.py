from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import random
from datetime import datetime

app = FastAPI(title="电气风险接口", description="工地安全监测系统 - 电气模块（lry负责）")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# 模拟电气设备数据
# 坐标与指标值与 工地布局图/electrical_boxes.geojson 保持一致
# ============================================================
devices = [
    {"device_id": "D001", "device_type": "配电箱", "location": [120.1170, 30.2800], "load": 35, "temperature": 45, "leakage": 0.1, "model": "XL-100", "install_date": "2025-06-15", "last_check": "2026-09-01"},
    {"device_id": "D002", "device_type": "配电箱", "location": [120.1180, 30.2798], "load": 85, "temperature": 62, "leakage": 0.3, "model": "XL-200", "install_date": "2025-06-15", "last_check": "2026-08-15"},
    {"device_id": "D003", "device_type": "开关柜", "location": [120.1190, 30.2802], "load": 45, "temperature": 50, "leakage": 0.2, "model": "KG-50", "install_date": "2025-06-20", "last_check": "2026-09-10"},
    {"device_id": "D004", "device_type": "配电箱", "location": [120.1165, 30.2805], "load": 15, "temperature": 40, "leakage": 0.1, "model": "XL-100", "install_date": "2025-06-15", "last_check": "2026-09-05"},
    {"device_id": "D005", "device_type": "电缆", "location": [120.1185, 30.2810], "load": 60, "temperature": 55, "leakage": 0.25, "model": "DL-3x50", "install_date": "2025-06-25", "last_check": "2026-09-08"},
    {"device_id": "D006", "device_type": "配电箱", "location": [120.1195, 30.2795], "load": 72, "temperature": 58, "leakage": 0.28, "model": "XL-150", "install_date": "2025-07-01", "last_check": "2026-08-20"},
    {"device_id": "D007", "device_type": "开关柜", "location": [120.1175, 30.2812], "load": 30, "temperature": 42, "leakage": 0.15, "model": "KG-30", "install_date": "2025-06-20", "last_check": "2026-09-12"},
    {"device_id": "D008", "device_type": "电缆", "location": [120.1182, 30.2808], "load": 55, "temperature": 52, "leakage": 0.22, "model": "DL-3x35", "install_date": "2025-06-25", "last_check": "2026-09-03"}
]


# ============================================================
# 风险评分模型（阈值线性映射 + 加权融合）
#
# 与「物理量直接除以满量程」的做法相比，本模型引入安全阈值概念：
# 低于安全阈值不产生风险，高于危险阈值记满分，中间线性插值。
# 这更符合现场临时用电的评判逻辑——负荷 60% 属正常工作状态，
# 不应与负荷 0% 一样被计入风险。
#
#   risk_score = 0.45 × 漏电超标度
#              + 0.35 × 负荷超标度
#              + 0.20 × 温度超标度
#
# 权重依据：
#   漏电 0.45 —— 直接导致触电伤亡，是临时用电最致命的风险
#   负荷 0.35 —— 过载会引发电缆发热甚至起火
#   温度 0.20 —— 温度多为过载/漏电的结果性指标，非独立成因
# ============================================================

# 各指标的安全阈值 / 危险阈值
LOAD_SAFE, LOAD_DANGER = 60.0, 95.0         # 负荷百分比 %，60% 为轻载上限，95% 接近满载
TEMP_SAFE, TEMP_DANGER = 40.0, 70.0         # 箱体温度 ℃，40℃ 为常温上限，70℃ 为危险上限
LEAK_SAFE, LEAK_DANGER = 0.1, 0.5           # 漏电电流 mA，0.1mA 为安全上限，0.5mA 为危险上限

# 三项指标权重（合计 1.0）
W_LEAK, W_LOAD, W_TEMP = 0.45, 0.35, 0.20

# 预警触发阈值（与评分阈值分开设置，避免边界值频繁误报）
LOAD_ALERT = 80.0                           # 负荷超过 80% 提示过载
TEMP_ALERT = 55.0                           # 温度超过 55℃ 提示高温
LEAK_ALERT = 0.3                            # 漏电超过 0.3mA 提示漏电


def _risk_ratio(value, safe, danger):
    """把物理量线性映射为 0-1 的超标程度"""
    if value <= safe:
        return 0.0
    if value >= danger:
        return 1.0
    return (value - safe) / (danger - safe)


def calc_risk_score(load, temperature, leakage):
    """计算电气风险评分 0-1"""
    r_load = _risk_ratio(load, LOAD_SAFE, LOAD_DANGER)
    r_temp = _risk_ratio(temperature, TEMP_SAFE, TEMP_DANGER)
    r_leak = _risk_ratio(leakage, LEAK_SAFE, LEAK_DANGER)

    risk = W_LEAK * r_leak + W_LOAD * r_load + W_TEMP * r_temp
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
    if load >= LOAD_ALERT:
        alerts.append("过载")
    if temperature >= TEMP_ALERT:
        alerts.append("高温")
    if leakage >= LEAK_ALERT:
        alerts.append("漏电")
    if not alerts:
        return "正常"
    if score >= 0.7:
        level = "严重"
    elif score >= 0.3:
        level = "警告"
    else:
        level = "关注"
    return f"{level}：" + "、".join(alerts)


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
                "risk_level": get_risk_level(score),
                "load": d["load"],
                "temperature": d["temperature"],
                "leakage": d["leakage"],
                "model": d.get("model", ""),
                "install_date": d.get("install_date", ""),
                "last_check": d.get("last_check", "")
            }
        })
    return {"type": "FeatureCollection", "features": features}
