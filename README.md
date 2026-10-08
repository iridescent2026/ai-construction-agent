# 工安智瞳 · GIS 模块（V18）

此分支保留 GIS 模块的根目录 `main:app` 入口，实际实现集中在 `gis/`；`frontend/` 与 main 同步。
包含工厂观测、区域告警、A/B 场景、GIS 人员移动、观测导入及五项分析接口。首页室外全景按确认范围只展示建筑。

## 启动

```powershell
python -m pip install -r requirements.txt
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

接口文档：http://127.0.0.1:8000/docs 。需要自动运行联动模拟时，在启动前设置 `$env:FACTORY_ANALYSIS_DEMO='1'`。
第二个终端运行 `python serve_frontend.py 8080 8000 8001 8002` 可查看前端；完整电气和智能体功能还需对应服务。
**推荐使用 main 分支的 `python run_demo.py` 一次启动完整项目。** 本分支不包含整合启动器或其他模块实现。

模块目录保持独立；`electrical`、`math` 和 `main` 分支名称不变。
传感器与轨迹默认使用明确标识的演示数据，手动观测导入不代表真实 GPS 接入。

- [V18 首页清理范围](docs/home-exterior-v18.md)
- [区域、定位与观测导入](docs/regions-observations-navigation-v17.md)
- [五项分析及数据接口](docs/factory-analysis-v15.md)
- [共享样式与采样](docs/shared-steel-and-feed-v16.md)
