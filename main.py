"""Shared metric geometry and persisted personnel observations."""
from fastapi import FastAPI, HTTPException
from common.runtime import configure_api, is_fresh
from pydantic import BaseModel, Field, ConfigDict, model_validator
from pathlib import Path
from datetime import datetime, timezone
import os
import json
import math
import sqlite3
from contextlib import contextmanager
from shapely.geometry import Point
try:
    from .spatial import load_zones_from_geojson, check_person_in_danger, zone_geojson
except ImportError:
    from spatial import load_zones_from_geojson, check_person_in_danger, zone_geojson

app = FastAPI(title="空间风险接口")
configure_api(app)
zones = load_zones_from_geojson(Path(__file__).with_name("danger_zones.geojson"))
all_people = [
    {"person_id": "P001", "lng": 120.008, "lat": 30.2945},
    {"person_id": "P002", "lng": 120.0100, "lat": 30.2935},
    {"person_id": "P003", "lng": 120.011, "lat": 30.292},
    {"person_id": "P004", "lng": 120.008, "lat": 30.2910},
    {"person_id": "P005", "lng": 120.006, "lat": 30.293},
]
DB_PATH = Path(os.environ.get("GIS_DB_PATH", Path(__file__).with_name("data.db")))


@contextmanager
def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=10)
    try:
        with db:
            yield db
    finally:
        db.close()


def init_db():
    with connect() as db:
        db.execute("CREATE TABLE IF NOT EXISTS people (id TEXT PRIMARY KEY, payload TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value INTEGER)")
        db.execute("BEGIN IMMEDIATE")
        if not db.execute("SELECT 1 FROM metadata WHERE key='revision'").fetchone():
            now = datetime.now(timezone.utc).isoformat()
            db.executemany("INSERT OR IGNORE INTO people VALUES (?,?)", [(p["person_id"],json.dumps({**p,"timestamp":now,"source":"demo"})) for p in all_people])
            db.execute("INSERT INTO metadata VALUES ('revision',0)")


init_db()


class PersonLocation(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    person_id: str = Field(min_length=1, max_length=64)
    lng: float = Field(ge=-180, le=180)
    lat: float = Field(ge=-90, le=90)


class BatchRequest(BaseModel):
    people: list[PersonLocation] = Field(min_length=1, max_length=1000)

    @model_validator(mode="after")
    def unique_ids(self):
        ids = [p.person_id for p in self.people]
        if len(ids) != len(set(ids)):
            raise ValueError("人员编号不能重复")
        return self


def snapshot():
    with connect() as db:
        db.execute("BEGIN")
        revision = db.execute("SELECT value FROM metadata WHERE key='revision'").fetchone()[0]
        people = [json.loads(row[0]) for row in db.execute("SELECT payload FROM people ORDER BY id")]
    return revision, [{**p,"fresh":is_fresh(p),"status":"online" if is_fresh(p) else "stale"} for p in people]


def observe(people, source="telemetry"):
    now = datetime.now(timezone.utc).isoformat()
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        if source.startswith("simulation_"):
            for p in people:
                row=db.execute("SELECT payload FROM people WHERE id=?",(p.person_id,)).fetchone()
                if row and json.loads(row[0]).get("source")=="telemetry":
                    raise HTTPException(409,"模拟编号已被真实上报占用")
        db.executemany("INSERT INTO people VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
                       [(p.person_id,json.dumps({**p.model_dump(),"timestamp":now,"source":source})) for p in people])
        db.execute("UPDATE metadata SET value=value+1 WHERE key='revision'")
        revision = db.execute("SELECT value FROM metadata WHERE key='revision'").fetchone()[0]
    return revision


@app.post("/check_danger")
def check_danger(loc: PersonLocation):
    # Existing clients treat this POST as an observation; keep that contract explicit.
    revision = observe([loc])
    return {**check_person_in_danger(loc.person_id,loc.lng,loc.lat,zones), "revision":revision}


@app.post("/check_danger_batch")
def check_danger_batch(req: BatchRequest):
    revision = observe(req.people)
    return {"revision":revision, "results":[check_person_in_danger(p.person_id,p.lng,p.lat,zones) for p in req.people]}


@app.post("/check_danger_preview")
def preview(loc: PersonLocation):
    return check_person_in_danger(loc.person_id,loc.lng,loc.lat,zones)


def summary(people):
    return [{"zone_id":z["zone_id"],"zone_type":z["zone_type"],"risk_level":z["risk_level"],
             "people_count":len(ids),"people_list":ids}
            for z in zones
            for ids in [[p["person_id"] for p in people if is_fresh(p) and z["geometry"].covers(Point(p["lng"],p["lat"]))]]]


def heatmap(people):
    return [{**z,"risk_score":round(min({"高":0.8,"中":0.5,"低":0.2}.get(z["risk_level"],0.2)+z["people_count"]*0.05,1),2)} for z in summary(people)]


@app.get("/people")
def get_people():
    revision, people = snapshot()
    return {"revision":revision,"people":people}


@app.get("/state")
def get_state():
    revision, people = snapshot()
    results=[]
    for p in people:
        if p["fresh"]:
            result=check_person_in_danger(p["person_id"],p["lng"],p["lat"],zones)
        else:
            result={"person_id":p["person_id"],"risk_level":"未知","inside_zone":False,
                    "in_buffer":False,"zone_id":None,"matches":[],"alert":"位置超过120秒未更新，仅显示最后已知位置"}
        results.append(result)
    return {"revision":revision,"people":people,"heatmap":heatmap(people),"results":results,
            "total_people":len(people),"fresh_people":sum(p["fresh"] for p in people),
            "unknown_people":sum(not p["fresh"] for p in people)}


@app.post("/simulation/tick")
def simulate_people():
    if os.getenv("DEMO_MODE","1") != "1":
        raise HTTPException(403,"正式数据模式不允许模拟采样")
    # Refresh demo observations without resetting reported positions.
    _, people=snapshot()
    if any(p.get("source") == "telemetry" for p in people):
        raise HTTPException(409,"含已上报位置，禁止用演示采样刷新其时间；请使用独立演示数据库")
    revision=observe([PersonLocation(**p) for p in people if p.get('source')=='demo'], source="demo")
    return {"revision":revision,"source":"demo","state":get_state()}


@app.get("/zone_summary")
def zone_summary():
    revision, people = snapshot()
    return {"revision":revision,"zones":summary(people)}


class MotionSample(BaseModel):
    mode: str = Field(pattern="^(phone|camera)$")
    step: int = Field(ge=0, le=100000)


@app.post("/simulation/motion")
def simulate_motion(sample: MotionSample):
    if os.getenv("DEMO_MODE", "1") != "1":
        raise HTTPException(403, "正式数据模式禁止模拟轨迹")
    phase=sample.step * 0.025
    # Separate identities; never overwrite real people or the original demo roster.
    prefix="SIM-GPS" if sample.mode == "phone" else "SIM-CAM"
    points=[PersonLocation(person_id=f"{prefix}-{i+1}",
        lng=120.008+0.0015*math.sin(phase+i*1.8),
        lat=30.293+0.0013*math.sin(phase*0.7+i*1.8)) for i in range(2)]
    observe(points, source=f"simulation_{sample.mode}")
    return {"simulated":True,"mode":sample.mode,"state":get_state()}


@app.get("/risk_heatmap")
def risk_heatmap():
    revision, people = snapshot()
    return {"revision":revision,"heatmap":heatmap(people)}


@app.get("/zones.geojson")
def get_zones():
    return zone_geojson(zones)


@app.get("/buffers.geojson")
def get_buffers():
    return zone_geojson(zones, buffers=True)
