# AI 施工安全空间智能体（工安智瞳）

面向施工现场的"安全+进度"协同智能体。

## 项目结构

```
ai-construction-agent/
├── frontend/                    # 前端可视化大屏（负责人：lxy）
│   ├── index.html               # 页面入口
│   ├── app.js                   # 调用各模块 API 并渲染
│   └── danger_zones.geojson     # 前端展示用危险区域数据
├── gis/                         # GIS 空间判断模块（wjy 负责）
│   ├── gis_check.py             # 核心空间判断逻辑
│   ├── main.py                  # FastAPI 接口服务（端口 8000）
│   └── danger_zones.geojson     # 危险区域数据
├── electrical/                  # 电气风险模块（lry 负责）
│   ├── main.py                  # FastAPI 接口服务（端口 8001）
│   └── README.md
├── math/                        # 智能体与算法模块（lxy 负责）
│   ├── main.py                  # FastAPI 接口服务（端口 8002）
│   └── README.md
├── docs/
│   └── api.md                   # 统一接口文档
├── .gitignore
└── README.md
```

> **⚠️ 分支状态提示**
> 上述为项目**完整结构**。各模块代码在其各自分支上开发完成后，
> 尚未合并到 `main`：`frontend/`、`electrical/main.py`、`math/main.py`
> 目前只存在于 `math` 分支。需要完整代码请切换到 `math` 分支：
> ```bash
> git clone -b math https://github.com/iridescent2026/ai-construction-agent.git
> ```
> 合并到 `main` 由全组统一决定。

## 服务端口约定

| 服务 | 端口 | 文件 |
|------|------|------|
| GIS 空间判断 | 8000 | `gis/main.py` |
| 电气风险 | 8001 | `electrical/main.py` |
| 智能体与算法 | 8002 | `math/main.py` |

## 统一约定

- **数据交换格式**：JSON
- **坐标格式**：`[经度, 纬度]`，统一使用工地实际坐标范围
  （经度约 120.007~120.010 / 纬度约 30.291~30.295）
- **风险评分**：统一为 `0.0 ~ 1.0`，越大越危险
- **风险等级**：`低`（<0.3）/ `中`（0.3~0.7）/ `高`（≥0.7）
- **数据来源**：先跑通 mock 数据，再接真实数据

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
- fastapi / uvicorn
- httpx（模块间 HTTP 调用）

## 安装

```bash
pip install shapely
pip install "fastapi[standard]"
pip install uvicorn httpx
```

## 运行

三个模块均为独立的 FastAPI 服务，需分别启动（各开一个终端）。

### GIS 空间判断（端口 8000）

```bash
cd gis
python -m uvicorn main:app --port 8000
```

单独测试空间判断逻辑（无需启服务）：

```bash
cd gis
python gis_check.py
```

### 电气风险（端口 8001）

```bash
cd electrical
python -m uvicorn main:app --port 8001
```

### 智能体与算法（端口 8002）

```bash
cd math
python -m uvicorn main:app --port 8002
```

### 前端

前端通过 HTTP 调用上述三个服务，直接用浏览器打开 `frontend/index.html`
即可（无需构建）。请确保三个后端服务已启动。

各服务启动后访问 `http://127.0.0.1:<端口>/docs` 查看交互式接口文档。

## 接口文档

详见 [docs/api.md](docs/api.md)

## 协作流程

1. 切换到自己的分支：`git checkout gis`（或 electrical / math）
2. 在自己分支上开发
3. 提交：`git commit -m "feat(gis): 添加缓冲区判断"`
4. 推送：`git push`
5. 在 GitHub 上发起 Pull Request，合并到 `main`
