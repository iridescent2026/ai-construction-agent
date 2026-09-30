# AI 施工安全空间智能体 · 接口文档

**版本：** v1.0  
**更新时间：** 2026-09-30  
**负责人：** GIS 组  
**基础地址：** `http://127.0.0.1:8000`

---

## 一、系统调用关系

```
┌─────────────────────────────────────────────────────┐
│                    前端 Web 看板                      │
│         （地图 + 风险点 + 对话框 + 巡检路线）          │
└──────────────────────┬──────────────────────────────┘
                       │ 调用
                       ▼
┌─────────────────────────────────────────────────────┐
│              数学同学：智能体决策层                    │
│   风险评分 | 路径优化 | 风险预测 | 工具调用 | 对话     │
└──────┬──────────────────────────────┬───────────────┘
       │ 调用                          │ 调用
       ▼                              ▼
┌──────────────────┐          ┌──────────────────┐
│ GIS 空间判断接口  │          │ 电气风险接口      │
│ （GIS 负责）      │          │ （电气负责）      │
└──────────────────┘          └──────────────────┘
```

---

## 二、GIS 接口（GIS 负责）

### 接口1：`POST /check_danger` — 单人危险区判断

**功能：** 输入人员坐标，判断是否在危险区内。

**请求：**
```json
{
  "person_id": "P001",
  "lng": 120.008,
  "lat": 30.2945
}
```

**返回：**
```json
{
  "person_id": "P001",
  "inside_zone": true,
  "in_buffer": false,
  "zone_id": "Z001",
  "zone_type": "基坑",
  "risk_level": "高",
  "alert": "人员P001进入基坑危险区"
}
```

**字段说明：**

| 字段 | 类型 | 含义 |
|---|---|---|
| person_id | string | 人员编号 |
| inside_zone | boolean | 是否在危险区内 |
| in_buffer | boolean | 是否在缓冲区边缘 |
| zone_id | string/null | 所在区域编号 |
| zone_type | string/null | 区域类型：基坑/吊装区/高空区 |
| risk_level | string | 风险等级：高/中/低 |
| alert | string | 预警文字 |

---

### 接口2：`POST /check_danger_batch` — 多人批量判断

**功能：** 一次传入多个人，返回每个人状态。

**请求：**
```json
{
  "people": [
    {"person_id": "P001", "lng": 120.008, "lat": 30.2945},
    {"person_id": "P002", "lng": 120.0100, "lat": 30.2935},
    {"person_id": "P003", "lng": 120.011, "lat": 30.292}
  ]
}
```

**返回：**
```json
{
  "results": [
    {"person_id": "P001", "inside_zone": true, "zone_id": "Z001", "zone_type": "基坑", "risk_level": "高", "alert": "..."},
    {"person_id": "P002", "inside_zone": true, "zone_id": "Z002", "zone_type": "吊装区", "risk_level": "中", "alert": "..."},
    {"person_id": "P003", "inside_zone": false, "zone_id": null, "zone_type": null, "risk_level": "低", "alert": "..."}
  ]
}
```

---

### 接口3：`GET /risk_heatmap` — 风险热力图数据

**功能：** 返回每个危险区域的风险评分和人数，供前端渲染热力图。

**请求：** 无

**返回：**
```json
{
  "heatmap": [
    {"zone_id": "Z001", "zone_type": "基坑", "risk_level": "高", "people_count": 1, "risk_score": 0.85},
    {"zone_id": "Z002", "zone_type": "吊装区", "risk_level": "中", "people_count": 1, "risk_score": 0.55},
    {"zone_id": "Z003", "zone_type": "高空区", "risk_level": "高", "people_count": 1, "risk_score": 0.85}
  ]
}
```

**字段说明：**

| 字段 | 类型 | 含义 |
|---|---|---|
| zone_id | string | 区域编号 |
| zone_type | string | 区域类型 |
| risk_level | string | 风险等级 |
| people_count | number | 区域内人数 |
| risk_score | number | 风险评分 0-1 |

---

### 接口4：`GET /zone_summary` — 区域风险汇总

**功能：** 返回每个区域当前人数和人员列表，供前端面板和数学同学路径优化使用。

**请求：** 无

**返回：**
```json
{
  "zones": [
    {"zone_id": "Z001", "zone_type": "基坑", "risk_level": "高", "people_count": 1, "people_list": ["P001"]},
    {"zone_id": "Z002", "zone_type": "吊装区", "risk_level": "中", "people_count": 1, "people_list": ["P002"]},
    {"zone_id": "Z003", "zone_type": "高空区", "risk_level": "高", "people_count": 1, "people_list": ["P004"]}
  ]
}
```

---

## 三、电气接口（电气负责 · 待补充）

### 接口5：`GET /devices` — 所有电气设备状态

**功能：** 返回所有配电箱的负荷、温度、漏电和风险评分。

**请求：** 无

**返回：**
```json
{
  "devices": [
    {
      "device_id": "D001",
      "device_type": "配电箱",
      "location": [120.007, 30.293],
      "load": 85,
      "temperature": 62,
      "leakage": 0.3,
      "risk_score": 0.78,
      "alert": "过载"
    }
  ]
}
```

**字段说明：**

| 字段 | 类型 | 含义 |
|---|---|---|
| device_id | string | 设备编号 |
| device_type | string | 设备类型：配电箱/电缆/开关 |
| location | array | 经纬度坐标 |
| load | number | 负荷百分比 |
| temperature | number | 温度（℃） |
| leakage | number | 漏电电流（mA） |
| risk_score | number | 风险评分 0-1 |
| alert | string | 预警文字 |

---

## 四、数学接口（数学负责 · 待补充）

### 接口6：`POST /risk` — 综合风险查询

**请求：**
```json
{
  "query": "今天哪个区域风险最高？"
}
```

**返回：**
```json
{
  "overall_risk": 0.82,
  "high_risk_zones": ["Z001"],
  "high_risk_devices": ["D003"],
  "prediction": "未来2小时基坑区风险上升",
  "suggestion": "立即疏散人员，检查2号配电箱"
}
```

---

### 接口7：`POST /route` — 巡检路线优化

**请求：**
```json
{
  "start_point": [120.007, 30.293],
  "risk_zones": ["Z001", "Z002"]
}
```

**返回：**
```json
{
  "inspection_route": ["P1", "P3", "P5"],
  "total_distance": 320,
  "estimated_time": 12,
  "reason": "优先覆盖高风险区域"
}
```

---

## 五、统一约定

1. 所有接口统一用 JSON 格式；
2. 所有坐标统一用 `[经度, 纬度]`；
3. 所有风险评分统一用 0-1；
4. 所有接口先用模拟数据跑通，再对接真实数据；
5. 接口变更必须提前在群里通知三人。

---

## 六、测试方式

- 启动后端：`python -m uvicorn gis.main:app --port 8000`
- 打开文档：`http://127.0.0.1:8000/docs`
- 在 `/docs` 里点 **Try it out** 即可测试。

---

## 七、Git 分支约定

| 分支 | 负责人 | 用途 |
|---|---|---|
| `main` | 共同 | 稳定版本 |
| `gis` | GIS | 空间判断模块 |
| `electrical` | 电气 | 电气风险模块 |
| `math` | 数学 | 智能体与算法 |

---

**文档维护：GIS 组 · 最后更新 2026-09-30**
