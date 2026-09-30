# AI 施工安全空间智能体

面向施工现场的"安全+进度"协同智能体。

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
