from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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
# 接口1：GET /devices — 所有设备状态
# ============================================================
@app.get("/devices")
def get_devices():
    result = []
    for d in devices:
        score = calc_risk_score(d["load"], d["temperature"], d["leakage"])
        result.append({
            "device_id": d["device_id"],
            "device_type": d["device_type"],
            "location": d["location"],
            "load": d["load"],
            "temperature": d["temperature"],
            "leakage": d["leakage"],
            "risk_score": score,
            "risk_level": get_risk_level(score),
            "alert": get_alert(d["load"], d["temperature"], d["leakage"], score)
        })
    return {"devices": result}


# ============================================================
# 接口2：GET /devices/{id} — 单设备详情
# ============================================================
@app.get("/devices/{device_id}")
def get_device(device_id: str):
    for d in devices:
        if d["device_id"] == device_id:
            score = calc_risk_score(d["load"], d["temperature"], d["leakage"])
            return {
                "device_id": d["device_id"],
                "device_type": d["device_type"],
                "location": d["location"],
                "load": d["load"],
                "temperature": d["temperature"],
                "leakage": d["leakage"],
                "risk_score": score,
                "risk_level": get_risk_level(score),
                "alert": get_alert(d["load"], d["temperature"], d["leakage"], score)
            }
    return {"error": "设备不存在"}
