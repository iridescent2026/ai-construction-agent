from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Body
from common.runtime import configure_api, is_fresh, allowed_origins
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, ConfigDict, model_validator
import httpx
import random
import json
import asyncio
import os
import hashlib
import sqlite3
import csv
import io
import re
from datetime import datetime, timedelta, timezone, date as CalendarDate
from openai import OpenAI

app = FastAPI()

configure_api(app)

GIS_API = os.getenv("GIS_API", "http://127.0.0.1:8000")
ELEC_API = os.getenv("ELEC_API", "http://127.0.0.1:8001")

# 工地中心坐标
SITE_CENTERS = {
    "site_a": [120.0080, 30.2935],
    "site_b": [121.4750, 31.2300],
    "site_c": [116.4000, 39.9000]
}

# 人员数据池
NAMES_POOL = ["张三", "李四", "王五", "赵六", "钱七", "孙八", "周九", "吴十", "郑十一", "冯十二"]
ROLES_POOL = ["操作员", "安全员", "电工", "指挥", "项目经理", "钢筋工", "木工", "焊工", "架子工", "测量员"]

# 人员移动状态（全局，每个 WS 连接共享）
people_movement = {}

# SQLite 数据持久化
DB_PATH = os.getenv("AGENT_DB_PATH", os.path.join(os.path.dirname(__file__), "data.db"))
conn = sqlite3.connect(DB_PATH, check_same_thread=False)
cursor = conn.cursor()
cursor.execute('''CREATE TABLE IF NOT EXISTS risk_history
    (date TEXT, hour TEXT, overall_risk REAL, high_zones INTEGER, high_devices INTEGER)''')
cursor.execute('''CREATE TABLE IF NOT EXISTS chat_logs
    (timestamp TEXT, session_id TEXT, query TEXT, answer TEXT, intent TEXT)''')
conn.commit()


def get_site_center(site_id):
    return SITE_CENTERS.get(site_id, SITE_CENTERS["site_a"])


def get_site_people(site_id):
    """根据工地 ID 动态生成人员（固定种子，结果稳定）"""
    seed = int(hashlib.md5(site_id.encode()).hexdigest()[:8], 16)
    rng = random.Random(seed)
    center = get_site_center(site_id)
    count = 12 if site_id == "site_a" else 8
    people = []
    for i in range(count):
        if site_id == "site_a":
            prefix = "P"
        elif site_id == "site_b":
            prefix = "S1-P"
        else:
            prefix = "S2-P"
        people.append({
            "id": f"{prefix}{i+1:03d}",
            "name": rng.choice(NAMES_POOL),
            "role": rng.choice(ROLES_POOL),
            "lng": center[0] + rng.uniform(-0.0015, 0.0015),
            "lat": center[1] + rng.uniform(-0.0015, 0.0015)
        })
    return people


# ============================================================
# LLM 客户端（DeepSeek）
# ============================================================
DEEPSEEK_KEY = os.getenv("DEEPSEEK_API_KEY", "")

llm_client = OpenAI(
    api_key=DEEPSEEK_KEY if DEEPSEEK_KEY else "sk-placeholder-please-set-env",
    base_url="https://api.deepseek.com",
    timeout=10.0
)

# 对话历史（每个 session 保留最近 10 轮）
from collections import defaultdict
sessions = defaultdict(list)


def llm_generate_answer(query, tool_name, tool_data):
    """把工具数据喂给 LLM，生成自然语言回答（带置信度）"""
    prompt = f"""用户问题：{query}

调用的工具：{tool_name}
工具返回的原始数据：
{json.dumps(tool_data, ensure_ascii=False, indent=2)}

请严格根据以上数据回答，规则：
1. 只能使用上面数据中出现的数字，不得编造或修改任何数值；
2. 直接回答用户问题；
3. 说明理由（引用具体数字）；
4. 给出可操作的建议；
5. 不超过 120 字。

请严格以 JSON 格式返回，不要包含任何其他文字或 markdown 标记：
{{"answer": "你的回答内容", "confidence": 0.95}}
confidence 范围 0.0-1.0，数据越充分置信度越高。"""

    try:
        response = llm_client.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {"role": "system", "content": "你是施工现场安全智能体。回答必须严格基于给定数据，不得编造数字。只输出 JSON。"},
                {"role": "user", "content": prompt}
            ],
            temperature=0
        )
        content = response.choices[0].message.content.strip()
        # 尝试解析 JSON
        try:
            # 清理可能的 markdown 代码块标记
            cleaned = content.replace('```json', '').replace('```', '').strip()
            result = json.loads(cleaned)
            return result["answer"], float(result.get("confidence", 0.8))
        except:
            return content, 0.6
    except Exception as e:
        print(f"LLM 生成回答失败: {e}")
        return "智能体暂时无法生成回答，请稍后重试。", 0.0


# ============================================================
# 工程进度配置
# ============================================================
PROGRESS = {
    "phase": "基坑开挖",
    "percent": 35,
    "planned_percent": 40,
    "actual_percent": 35,
    "start_date": "2026-09-01",
    "end_date": "2026-12-31",
    "phase_weight": 1.2,
    "phases": [
        {"name": "基坑开挖", "percent": 35, "risk_weight": 1.2, "status": "进行中"},
        {"name": "主体结构", "percent": 0, "risk_weight": 1.0, "status": "未开始"},
        {"name": "装修阶段", "percent": 0, "risk_weight": 0.8, "status": "未开始"}
    ]
}


def calc_schedule_factor(deviation):
    return 1.0, "进度偏差不能直接推断安全状态"


def get_dynamic_progress():
    return {**PROGRESS,"deviation":PROGRESS["actual_percent"]-PROGRESS["planned_percent"],
            "schedule_factor":1.0,"schedule_reason":"进度偏差不能直接推断安全状态",
            "source":"demo_config","is_live":False}


@app.get("/progress")
def get_progress():
    """返回工程进度（含偏差分析，动态波动）"""
    return get_dynamic_progress()


async def overview():
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            spatial_res,electrical_res=await asyncio.gather(client.get(f"{GIS_API}/state"),client.get(f"{ELEC_API}/devices"))
        spatial_res.raise_for_status(); electrical_res.raise_for_status()
        spatial,electrical=spatial_res.json(),electrical_res.json()
        zones=spatial["heatmap"]; devices=electrical["devices"]
        groups=summarize_devices(devices)["groups"]
        valid=[d for d in devices if d["device_id"] not in groups["未知"]]
        incomplete=bool(groups["未知"]) or not devices or bool(spatial.get("unknown_people"))
        known=max([z["risk_score"] for z in zones]+[d["risk_score"] for d in valid],default=0)
        high_people={r["person_id"] for r in spatial["results"] if r["risk_level"]=="高"}
        return {"overall_risk":None if incomplete else known,"known_risk_score":known,
                "data_complete":not incomplete,"suggestion":"数据不完整，请先核查未知状态" if incomplete else "按风险等级核查未处理隐患",
                "total_people":len({p["person_id"] for p in spatial["people"]}),
                "unknown_people":spatial.get("unknown_people",0),"high_risk_people":len(high_people),
                "total_devices":len(devices),"high_risk_devices":len(groups["高"]),"unknown_devices":len(groups["未知"]),
                "total_zones":len(zones),"high_risk_zones":sum(z["risk_level"]=="高" for z in zones),
                "gis_risk":zones,"elec_risk":devices,"device_groups":groups,
                "revision":spatial["revision"],"snapshot_id":electrical["snapshot_id"],
                "phase":PROGRESS["phase"],"progress_percent":PROGRESS["percent"],"progress_source":"demo_config"}
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        raise HTTPException(503,"上游数据不可用，不能计算当前综合风险")


@app.get("/risk")
async def get_risk():
    return await overview()


@app.get("/history/{date}")
async def get_history(date: CalendarDate):
    """Only stored observations, never generated history or writes on GET."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            res=await client.get(f"{ELEC_API}/devices"); res.raise_for_status()
            history=[]
            for device in res.json()["devices"]:
                res=await client.get(f"{ELEC_API}/devices/{device['device_id']}/history"); res.raise_for_status()
                for record in res.json()["history"]:
                    observed=datetime.fromisoformat(record["timestamp"]).astimezone(timezone(timedelta(hours=8)))
                    if observed.date()==date:
                        history.append(record)
        return {"date":date.isoformat(),"timezone":"Asia/Shanghai","history":sorted(history,key=lambda r:(r["timestamp"],r["device_id"])),
                "source":"stored_observations","retention":"每台最近20条、最近100个快照范围内；空列表表示无留存记录"}
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        raise HTTPException(503,"无法读取历史观测")


@app.get("/risk_timeline")
async def risk_timeline():
    data=await get_history(datetime.now(timezone(timedelta(hours=8))).date())
    return {**data,"timeline":data["history"]}


@app.get("/export/csv")
async def export_csv(site_id: str = "site_a"):
    if site_id != "site_a":
        raise HTTPException(404,"当前仅配置site_a")
    """导出风险热力图数据为 CSV"""
    async with httpx.AsyncClient() as client:
        res = await client.get(f"{GIS_API}/risk_heatmap?site_id={site_id}")
        data = res.json()["heatmap"]

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["区域ID", "区域类型", "风险等级", "人员数", "风险评分", "面积(㎡)"])
    for z in data:
        writer.writerow([
            z.get("zone_id", ""),
            z.get("zone_type", ""),
            z.get("risk_level", ""),
            z.get("people_count", 0),
            z.get("risk_score", 0),
            z.get("area", "")
        ])

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=risk_{site_id}.csv"}
    )


@app.get("/dashboard")
async def dashboard():
    return await overview()


# ============================================================
# 第2周：路径优化 + 智能体对话
# ============================================================
from ortools.constraint_solver import routing_enums_pb2
from ortools.constraint_solver import pywrapcp
from pydantic import BaseModel
from typing import List
import math as m


class Point(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    id: str = Field(min_length=1, max_length=64)
    lng: float = Field(ge=-180, le=180)
    lat: float = Field(ge=-90, le=90)
    risk: float = Field(default=0.0, ge=0, le=1)


class RouteRequest(BaseModel):
    points: List[Point] = Field(min_length=2, max_length=100)
    start_id: str

    @model_validator(mode="after")
    def validate_points(self):
        ids = [p.id for p in self.points]
        if len(set(ids)) != len(ids):
            raise ValueError("巡检点编号不能重复")
        if self.start_id not in ids:
            raise ValueError("起点必须包含在巡检点中")
        return self


class PersonLocation(BaseModel):
    person_id: str = Field(..., min_length=1, max_length=20)
    lng: float = Field(..., ge=-180.0, le=180.0)
    lat: float = Field(..., ge=-90.0, le=90.0)
    zone_id: str = ""
    risk_level: str = ""
    alert: str = ""


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
    """OR-Tools point-distance tour; not a verified walkable site route."""
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

    search_params.time_limit.seconds = 2
    solution = routing.SolveWithParameters(search_params)
    if not solution:
        raise HTTPException(422, "未找到巡检顺序")

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
        "reason": "依据点间距离计算巡检顺序，尚未校验现场通路和禁行区",
        "route_type": "point_distance",
        "walkability_verified": False,
        "solver": "OR-Tools"
    }


def route_reply(req, steps):
    if req is None:
        return {"success": False, "needs_input": True, "intent": "route",
                "answer": "请提供巡检点坐标及起点，再计算巡检顺序。", "tool_calls": [], "steps": steps}
    try:
        data = optimize_route(req)
        if "error" in data:
            raise ValueError(data["error"])
    except Exception:
        return {"success": False, "intent": "route", "answer": "路线计算失败，未生成结果，请检查巡检点后重试。",
                "tool_calls": [], "tool_results": [{"tool": "/route", "status": "error"}], "steps": steps}
    return {"success": True, "intent": "route", "tool_calls": ["/route"],
            "tool_results": [{"tool": "/route", "status": "success", "input": req.model_dump(), "output": data}],
            "route_data": data, "steps": steps + [{"step":len(steps)+1,"desc":"OR-Tools 已完成计算"}],
            "answer": f"已计算巡检顺序：{' → '.join(data['route'])}；点间距离约{data['total_distance']}米，"
                      f"按60米/分钟估算{data['estimated_time']}分钟。尚未校验现场通路和禁行区，不能作为安全通行指引。"}


def summarize_devices(data, now=None):
    now = now or datetime.now(timezone.utc)
    groups = {"高":[], "中":[], "关注":[], "正常":[], "未知":[]}
    for d in data:
        device_id = str(d.get("device_id", "未知设备"))
        try:
            timestamp = datetime.fromisoformat(d["timestamp"].replace("Z", "+00:00"))
            age = (now - timestamp).total_seconds()
            fresh = 0 <= age <= 120
        except (KeyError, ValueError, TypeError):
            fresh = False
        level = d.get("risk_level")
        alert = d.get("alert")
        valid_metrics = all(isinstance(d.get(k), (int,float)) and not isinstance(d.get(k), bool)
                            and m.isfinite(d[k]) for k in ("load","temperature","leakage","risk_score"))
        if not fresh or d.get("status") != "online" or level not in ("高","中","低") or not valid_metrics or not isinstance(alert,str) or not alert:
            groups["未知"].append(device_id)
        elif d.get("hard_alert") or level == "高":
            groups["高"].append(device_id)
        elif level == "中":
            groups["中"].append(device_id)
        elif alert != "正常":
            groups["关注"].append(device_id)
        else:
            groups["正常"].append(device_id)
    if not data:
        answer = "未获取到设备数据，无法判断电气状态。"
    elif len(groups["正常"]) == len(data):
        answer = f"本次有效快照中{len(data)}台设备均未触发配置预警。"
    else:
        labels = {"高":"高风险", "中":"中风险", "关注":"需关注", "未知":"离线、过期或数据不完整，状态未知"}
        answer = "；".join(f"{labels[k]}{len(groups[k])}台（{'、'.join(groups[k])}）" for k in labels if groups[k]) + "。"
        if groups["正常"]:
            answer += f"另有{len(groups['正常'])}台未触发配置预警。"
    return {"answer":answer, "groups":groups}


async def electrical_reply(steps):
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(f"{ELEC_API}/devices")
            response.raise_for_status()
            payload = response.json()
            data = payload["devices"]
            if not isinstance(data,list) or any(not isinstance(d,dict) for d in data):
                raise ValueError("Invalid device payload")
            summary = summarize_devices(data)
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return {"success":False, "intent":"electric", "answer":"无法获取有效设备数据，电气状态未知，请检查连接后重试。",
                "tool_calls":[], "tool_results":[{"tool":"/devices","status":"error"}], "steps":steps}
    return {"success":True, "intent":"electric", **summary, "snapshot_id":payload.get("snapshot_id"),
            "tool_calls":["/devices"], "steps":steps,
            "tool_results":[{"tool":"/devices","status":"success","output":payload}]}


async def risk_reply(steps):
    try:
        data=await overview()
    except HTTPException:
        return {"success":False,"answer":"当前数据源不可用，无法判断风险。","steps":steps,"tool_calls":[]}
    if not data["data_complete"]:
        answer=f"数据不完整：{data['unknown_people']}人位置过期或未知，{data['unknown_devices']}台设备状态未知，不能判断全场是否安全。"
    else:
        answer=f"当前已知综合风险评分{data['overall_risk']}，高风险设备{data['high_risk_devices']}台、高风险人员{data['high_risk_people']}人。"
    return {"success":True,"answer":answer,"steps":steps,"tool_calls":["/risk"],"tool_results":[{"tool":"/risk","output":data,"status":"success"}]}


@app.post("/chat")
async def chat(query: str, route_request: RouteRequest | None = Body(default=None)):
    """智能体对话：解析问题→调用工具→返回答案+推理步骤"""
    steps = []
    steps.append({"step": 1, "desc": f"解析问题：{query}"})

    if "巡检" in query or "路线" in query:
        return route_reply(route_request, steps)
    if "电气" in query or "配电" in query or "设备" in query:
        return await electrical_reply(steps)

    async with httpx.AsyncClient() as client:
        if "风险" in query or "危险" in query:
            return await risk_reply(steps)

        elif "进度" in query or "阶段" in query or "工期" in query:
            steps.append({"step": 2, "desc": "识别意图：进度查询"})
            steps.append({"step": 3, "desc": "读取进度数据"})
            steps.append({"step": 4, "desc": f"当前阶段：{PROGRESS['phase']}"})
            steps.append({"step": 5, "desc": "生成回答"})
            return {
                "answer": f"当前处于{PROGRESS['phase']}阶段，完成 {PROGRESS['percent']}%。该阶段风险权重为 {PROGRESS['phase_weight']}，需重点关注基坑安全。",
                "tool_calls": ["/progress"],
                "steps": steps
            }

        else:
            steps.append({"step": 2, "desc": "未识别明确意图"})
            steps.append({"step": 3, "desc": "返回帮助信息"})
            return {
                "answer": "我可以帮您查询风险、生成巡检路线、检查电气设备。",
                "tool_calls": [],
                "steps": steps
            }


# ============================================================
# LLM 对话接口
# ============================================================
@app.post("/chat_llm")
async def chat_llm(query: str, session_id: str = "default", route_request: RouteRequest | None = Body(default=None)):
    """用 LLM 做意图识别 + 工具调用（带对话历史）"""
    steps = []
    steps.append({"step": 1, "desc": f"解析问题：{query}"})

    # Explicit safety requests use deterministic tools even when no LLM key is configured.
    if "巡检" in query or "路线" in query:
        return route_reply(route_request, steps)
    if "电气" in query or "配电" in query or "设备" in query:
        return await electrical_reply(steps)

    history = sessions[session_id]

    # 用 LLM 判断意图（带历史上下文）
    system_prompt = """你是施工现场安全智能体。用户会问关于风险、电气、进度、巡检的问题。
请判断意图，只返回 JSON 格式：
{"intent": "risk"} 或 {"intent": "electric"} 或 {"intent": "progress"} 或 {"intent": "route"} 或 {"intent": "unknown"}
- risk：风险查询（如"哪个区域最危险"）
- electric：电气查询（如"配电箱怎么样"）
- progress：进度查询（如"现在到哪一步了"）
- route：巡检路线（如"规划巡检路线"）
- unknown：无法识别"""

    try:
        messages = [{"role": "system", "content": system_prompt}]
        for h in history[-2:]:
            messages.append({"role": "user", "content": h["query"]})
            messages.append({"role": "assistant", "content": "ok"})
        messages.append({"role": "user", "content": query + "\n\n只返回JSON："})

        response = llm_client.chat.completions.create(
            model="deepseek-chat",
            messages=messages,
            temperature=0
        )
        raw = response.choices[0].message.content.strip().lower()
        # 优先解析 JSON
        try:
            cleaned = raw.replace('```json', '').replace('```', '').strip()
            result = json.loads(cleaned)
            intent = result.get("intent", "unknown")
        except:
            # 兜底：正则提取
            match = re.search(r'(risk|electric|progress|route|unknown)', raw)
            intent = match.group(1) if match else "unknown"
    except Exception as e:
        intent = f"unknown(错误: {str(e)[:50]})"

    # 模糊匹配：确保意图是有效值
    valid_intents = ["risk", "electric", "progress", "route"]
    matched = None
    for vi in valid_intents:
        if vi in intent:
            matched = vi
            break
    if matched:
        intent = matched
    elif history and "unknown" in intent:
        # 追问场景：识别不出来时沿用上一轮意图
        last_intent = history[-1].get("intent", "")
        if last_intent in valid_intents:
            intent = last_intent
            steps.append({"step": 2, "desc": f"追问场景，沿用上轮意图：{intent}"})

    if len(steps) < 2 or not steps[1]["desc"].startswith("追问"):
        steps.append({"step": 2, "desc": f"LLM 识别意图：{intent}"})

    # 根据意图调用对应工具
    async with httpx.AsyncClient() as client:
        if "risk" in intent:
            return await risk_reply(steps)

        elif "electric" in intent:
            return await electrical_reply(steps)

        elif "progress" in intent:
            steps.append({"step": 3, "desc": "读取进度数据"})

            progress_data = get_dynamic_progress()
            steps.append({"step": 4, "desc": f"当前阶段：{progress_data['phase']}，偏差 {progress_data['deviation']}%"})

            steps.append({"step": 5, "desc": "LLM 生成回答"})
            answer, confidence = llm_generate_answer(query, "/progress", progress_data)

            history.append({"query": query, "answer": answer, "intent": intent})
            sessions[session_id] = history[-10:]
            try:
                cursor.execute("INSERT INTO chat_logs VALUES (?, ?, ?, ?, ?)",
                               (datetime.now().isoformat(), session_id, query, answer, intent))
                conn.commit()
            except Exception as e:
                print(f"写入聊天记录失败: {e}")
            return {
                "answer": answer,
                "tool_calls": ["/progress"],
                "steps": steps,
                "confidence": confidence,
                "intent": intent
            }

        elif "route" in intent:
            return route_reply(route_request, steps)

        else:
            steps.append({"step": 3, "desc": "未识别意图"})
            answer = "我可以帮您查询：\n1. 风险（如\"哪个区域最危险？\"）\n2. 电气设备（如\"配电箱怎么样？\"）\n3. 工程进度（如\"现在到哪一步了？\"）\n4. 巡检路线（如\"规划一条巡检路线\"）"
            history.append({"query": query, "answer": answer, "intent": intent})
            sessions[session_id] = history[-10:]
            try:
                cursor.execute("INSERT INTO chat_logs VALUES (?, ?, ?, ?, ?)",
                               (datetime.now().isoformat(), session_id, query, answer, intent))
                conn.commit()
            except Exception as e:
                print(f"写入聊天记录失败: {e}")
            return {
                "answer": answer,
                "tool_calls": [],
                "steps": steps,
                "confidence": confidence,
                "intent": intent
            }


# ============================================================
# WebSocket：实时数据推送
# ============================================================
@app.websocket("/ws/data")
async def websocket_data(websocket: WebSocket, site_id: str = "site_a"):
    """Relay the same persisted observations as REST; never generate a second data source."""
    origin = websocket.headers.get("origin")
    if origin and origin not in allowed_origins():
        await websocket.close(code=1008, reason="不允许此网页来源")
        return
    await websocket.accept()
    if site_id != "site_a":
        await websocket.close(code=1008, reason="当前集成版本仅配置site_a")
        return
    previous_snapshot = None
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            while True:
                try:
                    devices_response = await client.get(f"{ELEC_API}/devices")
                    people_response = await client.get(f"{GIS_API}/state")
                    devices_response.raise_for_status()
                    people_response.raise_for_status()
                    electrical = devices_response.json()
                    spatial = people_response.json()
                    summary = summarize_devices(electrical["devices"])
                    new_alerts = []
                    if electrical["snapshot_id"] != previous_snapshot:
                        new_alerts = [{"device_id":i,"level":"高","message":f"{i}高风险，请核查"}
                                      for i in summary["groups"]["高"]]
                    await websocket.send_json({
                        "type":"sensor_update", "site_id":site_id,
                        "timestamp":datetime.now(timezone.utc).isoformat(),
                        "snapshot_id":electrical["snapshot_id"], "revision":spatial["revision"],
                        "person_updates":spatial["people"], "device_updates":electrical["devices"],
                        "new_alerts":new_alerts, "device_summary":summary
                    })
                    previous_snapshot = electrical["snapshot_id"]
                except (httpx.HTTPError, ValueError, KeyError, TypeError):
                    await websocket.send_json({"type":"data_error","message":"数据源不可用，当前状态未知"})
                await asyncio.sleep(3)
    except WebSocketDisconnect:
        return
