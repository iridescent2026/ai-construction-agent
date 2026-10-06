# AI 施工安全空间智能体

面向施工现场的"安全+进度"协同智能体。

## 工厂数字孪生与卫星影像参考（V7，2026-10-06）

首页直接展示工厂全景、A 区自动化装配车间和 B 区地下动力室。采用机械金属面板、原版 Logo、可调宽左侧功能面板和小型悬浮标识；25 台设备、26 位人员、8 个危险区域共用后台观测，每秒同步，人员或未授权车辆进入危险范围产生报警。

GIS 工作台增加杭州公开厂区的真实卫星影像、厂区平面和遥感参考三维外观；A/B 工区沿用首页的安全演示模型。三维设计、内部工区、业务点位及报警属于演示，未进行现场测绘配准，不能代表该真实企业的监控结果。卫星影像带采集日期和来源，并非实时影像。

- 数字孪生首页：`http://127.0.0.1:8080/`
- GIS 遥感参考：`http://127.0.0.1:8080/workbench.html`
- 三处候选厂区与现有模型比对：`http://127.0.0.1:8080/map-reference.html`
- [场景与交互说明](docs/factory-threeviews.md)、[实时数据接口](docs/factory-realtime.md)、[卫星图选址与来源](docs/satellite-reference.md)

启动方式沿用下文；模型资产、地图组件已随仓库提供。卫星底图需连接官方在线影像服务。验证：59 项后端测试、23 项前端测试通过。

## 施工场景建模升级（V6，2026-10-06）

完善 GIS 对齐的基坑支护、楼栋脚手架、塔吊、办公区、道路和工程车辆；新增模型点选、俯视总图、楼栋剖切、模型与标牌开关及标签避让。P002 保留在 Z002 内偏离中心的位置。模型高度为演示示意，启动方式沿用下文。验证：49 项后端、10 项前端测试通过。[操作、效果图与建模说明](docs/construction-model-v6.md)。

## 重工业管理工作台（V5）

新增上下滚动管理区、设备监测表、人员管理表、重型钢框螺钉和工地背景。[操作与验收](docs/heavy-steel-v5.md)。

## 钢制控制台与折叠布局（V4）

已应用钢制设备舱、选定 Logo、全景抽屉及演示模式。[操作说明](docs/steel-v4.md)。

## 工业风与移动感知演示（2026-10-05）

新增工地建筑、塔吊、围挡及车辆示意；工业风界面与手机定位/摄像头坐标模拟。详见 [操作与真实接入边界](docs/industrial-v3.md)。两种来源均为模拟，未运行真实视频 AI 或手机 GPS 采集。验证：49 项后端、7 项前端测试。

## 3D 与可靠性升级（2026-10-05）

新增可交互 3D、常驻图例、跨视图图层开关、设备定位与过期状态。已完成 46 项后端和 6 项前端测试。详见 [升级问题清单与验收](docs/improvements-v2.md)。启动方式沿用下文。当前按钮为“更新演示观测”，会更新两类演示观测；“刷新数据”只读。三维高度仅示意，路线仍为点间巡检顺序。

## P0 修复集成版（2026-10-04）

本版本以 electrical 分支为基础，纳入 math 分支提交
`4b4b6625022bd896d318eac5483dc317fc3589fa` 的智能体服务，修复八项一致性问题。
当前完整集成的演示工地是 `site_a`。设备位置是与 GIS 对齐的演示台账，非实测坐标。

**推荐启动方式**（在仓库根目录）：

```powershell
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python run_demo.py
```

打开 http://127.0.0.1:8080 。三个接口服务分别使用 8000、8001、8002 端口。
按 Ctrl+C 停止本次启动的服务。Linux/macOS 使用 `.venv/bin/python`。
如果默认端口已被其他项目占用，可先设置 `$env:DEMO_PORT_OFFSET='10000'`，
再启动；此时页面为 http://127.0.0.1:18080，接口为18000/18001/18002，页面配置自动同步。
本次验证环境为 Windows / Python 3.14.5；`requirements-lock.txt` 保存完整测试环境版本。

电气页点击“生成下一帧演示数据”才会更新模拟数据，查询和刷新不会制造新数据。
助手页可查询电气状态，或选择起点并输入“规划巡检路线”；这两项不需要大模型密钥。
路线为 OR-Tools 计算的点间巡检顺序，尚不包含道路/禁入区约束。
其他大模型意图识别功能使用环境变量 `DEEPSEEK_API_KEY`；密钥不得写入代码。

自动验证：

```powershell
.venv/Scripts/python -m pip install -r requirements-dev.txt
.venv/Scripts/python -m pytest -q
node --test tests/*.test.cjs
```

详见 [P0修复说明](docs/p0-fixes.md) 与 [当前接口契约](docs/api-p0.md)。
下方原始模块说明及 `docs/api.md` 是旧版参考；冲突时以以上启动方法和当前契约为准。
电气阈值沿用项目演示配置，尚未完成真实设备适用性验证；本次修复不代表工程安全认证。

## 项目结构

```
ai-construction-agent/
├── gis/              # GIS 空间判断模块（wjy 负责）
│   ├── gis_check.py       # 核心空间判断逻辑
│   ├── main.py            # FastAPI 接口服务
│   └── danger_zones.geojson  # 危险区域数据
├── electrical/       # 电气风险模块（lry 负责）
├── math/             # 智能体与算法模块（lxy 负责）
├── docs/             # 接口文档
│   └── api.md
└── README.md
```

## 分支说明

| 分支 | 负责人 | 用途 |
|------|--------|------|
| `main` | 全员 | 稳定发布代码 |
| `gis` | wjy | GIS 空间判断模块开发 |
| `electrical` | lry | 电气风险模块开发 |
| `math` | lxy | 智能体与算法模块开发 |

## 环境要求

- Python 3.10+
- shapely
- fastapi

## 安装

```bash
pip install shapely
pip install "fastapi[standard]"
```

## 运行

### GIS 空间判断（本地测试）

```bash
cd gis
python gis_check.py
```

### GIS FastAPI 接口服务

```bash
cd gis
python -m uvicorn main:app --port 8000
```

访问 `http://127.0.0.1:8000/docs` 查看接口文档。

## 接口文档

详见 [docs/api.md](docs/api.md)

## 协作流程

1. 切换到自己的分支：`git checkout gis`（或 electrical / math）
2. 在自己分支上开发
3. 提交：`git commit -m "feat(gis): 添加缓冲区判断"`
4. 推送：`git push`
5. 在 GitHub 上发起 Pull Request，合并到 `main`
