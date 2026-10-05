# AI 施工安全空间智能体

面向施工现场的"安全+进度"协同智能体。

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
node --test tests/frontend.test.cjs
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
