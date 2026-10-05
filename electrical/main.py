"""Electrical demo: telemetry writes snapshots; reads never simulate measurements."""
from fastapi import FastAPI, HTTPException
from common.runtime import configure_api, is_fresh
from pydantic import BaseModel, Field, ConfigDict, model_validator
from datetime import datetime, timezone
from pathlib import Path
import os
import json
import random
import sqlite3
import uuid
from contextlib import contextmanager

app = FastAPI(title="电气风险接口")
configure_api(app)

# Demonstration thresholds retained from the original project; not certified equipment limits.
LOAD_SAFE, LOAD_DANGER = 60.0, 95.0
TEMP_SAFE, TEMP_DANGER = 40.0, 70.0
LEAK_SAFE, LEAK_DANGER = 0.1, 0.5
W_LEAK, W_LOAD, W_TEMP = 0.45, 0.35, 0.20
LOAD_ALERT, TEMP_ALERT, LEAK_ALERT = 80.0, 55.0, 0.3
RULE_VERSION = "demo-electrical-v2"

# Demo fixtures share the GIS site coordinate frame.
devices = [{'device_id': 'D001', 'device_type': '配电箱', 'location': [120.007, 30.293], 'load': 35, 'temperature': 45, 'leakage': 0.1, 'model': 'XL-100', 'install_date': '2025-06-15', 'last_check': '2026-09-01', 'site_id': 'site_a'}, {'device_id': 'D002', 'device_type': '配电箱', 'location': [120.008, 30.2928], 'load': 85, 'temperature': 62, 'leakage': 0.3, 'model': 'XL-200', 'install_date': '2025-06-15', 'last_check': '2026-08-15', 'site_id': 'site_a'}, {'device_id': 'D003', 'device_type': '开关柜', 'location': [120.009, 30.2932], 'load': 45, 'temperature': 50, 'leakage': 0.2, 'model': 'KG-50', 'install_date': '2025-06-20', 'last_check': '2026-09-10', 'site_id': 'site_a'}, {'device_id': 'D004', 'device_type': '配电箱', 'location': [120.0065, 30.2935], 'load': 15, 'temperature': 40, 'leakage': 0.1, 'model': 'XL-100', 'install_date': '2025-06-15', 'last_check': '2026-09-05', 'site_id': 'site_a'}, {'device_id': 'D005', 'device_type': '电缆', 'location': [120.0085, 30.294], 'load': 60, 'temperature': 55, 'leakage': 0.25, 'model': 'DL-3x50', 'install_date': '2025-06-25', 'last_check': '2026-09-08', 'site_id': 'site_a'}, {'device_id': 'D006', 'device_type': '配电箱', 'location': [120.0095, 30.2925], 'load': 72, 'temperature': 58, 'leakage': 0.28, 'model': 'XL-150', 'install_date': '2025-07-01', 'last_check': '2026-08-20', 'site_id': 'site_a'}, {'device_id': 'D007', 'device_type': '开关柜', 'location': [120.0075, 30.2942], 'load': 30, 'temperature': 42, 'leakage': 0.15, 'model': 'KG-30', 'install_date': '2025-06-20', 'last_check': '2026-09-12', 'site_id': 'site_a'}, {'device_id': 'D008', 'device_type': '电缆', 'location': [120.0082, 30.2938], 'load': 55, 'temperature': 52, 'leakage': 0.22, 'model': 'DL-3x35', 'install_date': '2025-06-25', 'last_check': '2026-09-03', 'site_id': 'site_a'}]

DB_PATH = Path(os.environ.get("ELECTRICAL_DB_PATH", Path(__file__).with_name("data.db")))


def _risk_ratio(value, safe, danger):
    return max(0.0, min(1.0, (value - safe) / (danger - safe)))


def weighted_score(load, temperature, leakage):
    return round(W_LOAD * _risk_ratio(load, LOAD_SAFE, LOAD_DANGER)
                 + W_TEMP * _risk_ratio(temperature, TEMP_SAFE, TEMP_DANGER)
                 + W_LEAK * _risk_ratio(leakage, LEAK_SAFE, LEAK_DANGER), 2)


def danger_reasons(load, temperature, leakage):
    return [name for value, limit, name in [(load, LOAD_DANGER, "负荷达到危险阈值"),
            (temperature, TEMP_DANGER, "温度达到危险阈值"),
            (leakage, LEAK_DANGER, "漏电达到危险阈值")] if value >= limit]


def calc_risk_score(load, temperature, leakage):
    # Preserve the public score/level contract; ranking_score retains the original weighted value.
    score = weighted_score(load, temperature, leakage)
    return max(0.7, score) if danger_reasons(load, temperature, leakage) else score


def get_risk_level(score):
    return "高" if score >= 0.7 else "中" if score >= 0.3 else "低"


def get_alert(load, temperature, leakage, score):
    alerts = [name for value, limit, name in [(load, LOAD_ALERT, "负荷预警"),
              (temperature, TEMP_ALERT, "高温"), (leakage, LEAK_ALERT, "漏电预警")] if value >= limit]
    if not alerts:
        return "正常"
    prefix = "严重" if score >= 0.7 else "警告" if score >= 0.3 else "关注"
    return prefix + "：" + "、".join(alerts)


def build_device_response(d):
    load, temperature, leakage = d["load"], d["temperature"], d["leakage"]
    score = calc_risk_score(load, temperature, leakage)
    reasons = danger_reasons(load, temperature, leakage)
    return {**d, "risk_score": score, "ranking_score": weighted_score(load, temperature, leakage),
            "risk_level": get_risk_level(score), "hard_alert": bool(reasons),
            "hard_alert_reasons": reasons, "rule_version": RULE_VERSION,
            "alert": get_alert(load, temperature, leakage, score)}


@contextmanager
def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=10)
    try:
        with db:
            yield db
    finally:
        db.close()


def save_snapshot(db, rows):
    snapshot_id = uuid.uuid4().hex
    data = {"snapshot_id": snapshot_id, "timestamp": datetime.now(timezone.utc).isoformat(),
            "devices": [build_device_response(d) for d in rows]}
    for d in data["devices"]:
        d["snapshot_id"] = snapshot_id
    db.execute("INSERT INTO snapshots (id, payload) VALUES (?, ?)",
               (snapshot_id, json.dumps(data, ensure_ascii=False)))
    # Bounded retention; clients requesting an expired snapshot receive 404, never a substitute.
    db.execute("DELETE FROM snapshots WHERE seq NOT IN (SELECT seq FROM snapshots ORDER BY seq DESC LIMIT 100)")
    return data


def init_db():
    with connect() as db:
        db.execute("CREATE TABLE IF NOT EXISTS snapshots (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE, payload TEXT NOT NULL)")
        db.execute("BEGIN IMMEDIATE")
        if not db.execute("SELECT 1 FROM snapshots LIMIT 1").fetchone():
            now = datetime.now(timezone.utc).isoformat()
            save_snapshot(db, [{**d, "timestamp": now, "source": "demo", "status": "online"} for d in devices])


init_db()


def read_snapshot(snapshot_id=None, db=None):
    if db is None:
        with connect() as connection:
            return read_snapshot(snapshot_id, connection)
    row = db.execute("SELECT payload FROM snapshots WHERE id=?", (snapshot_id,)).fetchone() if snapshot_id else db.execute("SELECT payload FROM snapshots ORDER BY seq DESC LIMIT 1").fetchone()
    if not row:
        raise HTTPException(404, "快照不存在或已过期")
    return json.loads(row[0])


class Reading(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    device_id: str = Field(min_length=1)
    load: float = Field(ge=0)
    temperature: float
    leakage: float = Field(ge=0)


class TelemetryRequest(BaseModel):
    readings: list[Reading] = Field(min_length=1, max_length=1000)

    @model_validator(mode="after")
    def unique_ids(self):
        ids = [r.device_id for r in self.readings]
        if len(ids) != len(set(ids)):
            raise ValueError("设备编号不能重复")
        return self


@app.post("/telemetry")
def ingest(req: TelemetryRequest):
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        rows = read_snapshot(db=db)["devices"]
        updates = {r.device_id: r.model_dump() for r in req.readings}
        unknown = set(updates) - {d["device_id"] for d in rows}
        if unknown:
            raise HTTPException(404, "设备不存在：" + ",".join(sorted(unknown)))
        now = datetime.now(timezone.utc).isoformat()
        return save_snapshot(db, [{**d, **updates[d["device_id"]], "timestamp": now,
                                  "source": "telemetry", "status": "online"} if d["device_id"] in updates else d for d in rows])


@app.post("/simulation/tick")
def simulation_tick():
    if os.getenv("DEMO_MODE","1") != "1":
        raise HTTPException(403,"正式数据模式不允许模拟采样")
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        if any(d.get("source") == "telemetry" for d in read_snapshot(db=db)["devices"]):
            raise HTTPException(409,"当前含已上报数据，禁止用随机样本覆盖；请使用独立演示数据库")
        now = datetime.now(timezone.utc).isoformat()
        rows = [{**d, "load": max(0, min(100, d["load"] + random.randint(-10,10))),
                 "temperature": d["temperature"] + random.randint(-5,5),
                 "leakage": round(max(0, d["leakage"] + random.uniform(-0.1,0.1)),2),
                 "timestamp": now, "source": "demo", "status": "online"} for d in devices]
        return save_snapshot(db, rows)


@app.get("/devices")
def get_devices(snapshot_id: str | None = None):
    return read_snapshot(snapshot_id)


@app.get("/devices.geojson")
def devices_geojson(snapshot_id: str | None = None):
    data = read_snapshot(snapshot_id)
    return {"type": "FeatureCollection", "snapshot_id": data["snapshot_id"],
            "timestamp": data["timestamp"], "features": [
                {"type": "Feature", "geometry": {"type": "Point", "coordinates": d["location"]},
                 "properties": d} for d in data["devices"]]}


class BatchRequest(BaseModel):
    device_ids: list[str]


@app.post("/devices/batch")
def get_devices_batch(req: BatchRequest, snapshot_id: str | None = None):
    data = read_snapshot(snapshot_id)
    by_id = {d["device_id"]: d for d in data["devices"]}
    if set(req.device_ids) - by_id.keys():
        raise HTTPException(404, "包含不存在的设备")
    return {**data, "devices": [by_id[i] for i in dict.fromkeys(req.device_ids)]}


@app.get("/devices/{device_id}/history")
def get_device_history(device_id: str):
    get_device(device_id)
    with connect() as db:
        snapshots = db.execute("SELECT payload FROM snapshots ORDER BY seq").fetchall()
    records = {}
    for (payload,) in snapshots:
        for d in json.loads(payload)["devices"]:
            if d["device_id"] == device_id:
                records[d["timestamp"]] = d
    return {"device_id": device_id, "history": list(records.values())[-20:]}


@app.get("/devices/{device_id}")
def get_device(device_id: str, snapshot_id: str | None = None):
    for d in read_snapshot(snapshot_id)["devices"]:
        if d["device_id"] == device_id:
            return d
    raise HTTPException(404, "设备不存在")
