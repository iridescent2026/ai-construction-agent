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
    # 电气风险取最高（乘 0.8 权重）
    elec_max = max(d["risk_score"] for d in elec_data) * 0.8 if elec_data else 0

    # 综合评分
    overall = round(max(gis_max, elec_max), 2)

    # 建议
    if overall >= 0.7:
        suggestion = "立即疏散高风险区域人员，检查高风险设备"
    elif overall >= 0.3:
        suggestion = "加强巡检，关注高风险区域"
    else:
        suggestion = "保持正常监测"

    return {
        "overall_risk": overall,
        "gis_risk": gis_data,
        "elec_risk": elec_data,
        "suggestion": suggestion
    }
