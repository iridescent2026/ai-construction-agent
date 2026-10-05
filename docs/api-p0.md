# P0 集成版接口契约

所有坐标使用 WGS84 `[经度, 纬度]`；空间距离使用米。单工地演示 `site_a`。

## 电气服务（8001）

- `GET /devices`：读取最新已提交快照，返回 snapshot_id、timestamp、devices。读取不会改变数值或历史。
- `GET /devices.geojson`：同源快照的 GeoJSON。上述两个接口均可指定 `?snapshot_id=...`，在并发更新时读取同一版数据。不存在/已淘汰的快照返回404，不自动替换。
- `GET /devices/{device_id}`：同源详情；可指定snapshot_id；未知设备404。
- `POST /devices/batch`：body `{"device_ids":["D001","D002"]}`；可指定snapshot_id；包含未知设备时整个请求404。
- `GET /devices/{device_id}/history`：最近20条实际采集记录（在最近100个快照保留范围内）；重复读取不新增历史。
- `POST /simulation/tick`：显式生成一帧演示数据，并返回这帧完整快照。会更新所有演示设备，仅用于本地演示。
- `POST /telemetry`：原子更新所提交设备，未提交设备保留原观测及时间。负值负荷/漏电、非有限数值、重复ID返回422；未知ID返回404，均不会部分写入。

```json
{"readings":[{"device_id":"D001","load":35,"temperature":70,"leakage":0.1}]}
```

记录字段：risk_score为兼容现有等级的告警分数；ranking_score为原始加权排序分；hard_alert及hard_alert_reasons记录单项硬规则；rule_version标记规则版本。任何指标达到项目配置危险阈值，risk_score至少0.7、risk_level为高。阈值仍是演示配置。

timestamp为服务收到观测的UTC时间；source为demo或telemetry。当前上报契约未接入传感器原始采样时间与乱序处理，不应当作真实设备接入协议。SQLite按事务保存快照，最多保留100版。环境变量ELECTRICAL_DB_PATH可指定库路径。

## GIS服务（8000）

- `POST /check_danger`：**上报并判定**单人位置，写入统一人员状态；body为person_id、lng、lat。
- `POST /check_danger_batch`：原子上报多个位置，body为`{"people":[...]}`；不删除未上报人员。
- `POST /check_danger_preview`：仅做假设位置判定，不更新人员状态。
- `GET /people`：读取当前已知位置及revision。
- `GET /state`：同一revision下的people、results、heatmap。前端应读此接口，不重复上传演示初始位置。
- `GET /zone_summary`、`GET /risk_heatmap`：读取持久化人员状态，返回revision。
- `GET /zones.geojson`、`GET /buffers.geojson`：返回区域及按米外扩后的多边形；前端不再自行画中心圆。

每个区域使用以区域中心建立的本地AEQD米制投影。buffer_radius的单位为米；判定和显示共用投影。边界计入区域内，缓冲阈值包含外边界。matches列出全部命中；主结果依次按风险高低、内部优先、区域ID排序，与输入数组顺序无关。distance_to_boundary单位为米，distance_unit=m。人员可同时计入多个重叠区域，区域人数不能直接相加作为唯一人员总数。

上报的人员编号与坐标必须有效，重复编号的批次被拒绝。SQLite保证批次原子更新并跨重启保留；GIS_DB_PATH可指定库路径。此版本不含人员过期离场规则或多传感器观测排序。

## 智能体服务（8002）

- `POST /route`：实际执行OR-Tools求解。至少2点，最多100点，ID唯一，起点必须在点集内，坐标合法；否则422。
- `POST /chat?query=规划巡检路线` 与 `POST /chat_llm?query=规划巡检路线`：请求体同下；两者使用与/route一致的求解函数。缺少请求体返回needs_input=true、success=false，不宣称已完成。求解失败返回success=false及失败tool_results。成功含实际route_data、工具入参和结果。

```json
{"start_id":"D001","points":[
  {"id":"D001","lng":120.007,"lat":30.293,"risk":0.1},
  {"id":"D002","lng":120.008,"lat":30.2928,"risk":0.7}
]}
```

路线返回闭合巡检顺序、点间距离（米）、按60米/分钟估算的时间（分钟）、solver=OR-Tools、walkability_verified=false。risk字段保留兼容性，当前目标仍为点间距离，**不宣称实现风险优先或安全可通行路径**。

- `POST /chat?query=电气设备状态怎么样` 与对应/chat_llm：读取电气快照后用确定性规则总结高、中、关注、正常及未知组。时间超过120秒、时间在未来、无时区/无时间、离线、缺关键数值均归为未知。空数据和接口失败不会回答正常。高/中风险及低风险预警不会被说成全部正常。该结论不经大模型自由改写。
- 明确的路线和电气问题无密钥也可工作；大模型识别为route/electric的其他表达复用相同执行路径。
- `/ws/data`转发电气和GIS实际存储的数据，带snapshot_id和revision，不另造模拟值；当前只接受site_a。数据源失败发送data_error。

GIS_API、ELEC_API配置上游地址；AGENT_DB_PATH指定智能体原有日志库。
导入math分支的其他接口保持既有演示性质（如进度与历史），不属于本次八项修复的验收范围。
