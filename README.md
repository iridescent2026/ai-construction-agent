# 工安智瞳 · 智能体与路线算法模块

当前模块实现与 V18 整合版一致；此次同步共享观测时间校验，非字符串时间戳按未知/过期处理。
保留本分支原有根目录 `main.py` 和目录结构。完整界面与联合演示请使用 main 分支。

```powershell
python -m pip install -r requirements.txt
python -m uvicorn main:app --host 127.0.0.1 --port 8002
```

接口文档：http://127.0.0.1:8002/docs 。完整启动方式：在 main 分支运行 `python run_demo.py`。

GIS_API 与 ELEC_API 默认分别指向 http://127.0.0.1:8000 和 http://127.0.0.1:8001。电气查询和 OR-Tools 巡检顺序不需要密钥；其他大模型意图使用环境变量 DEEPSEEK_API_KEY。

[当前接口契约](docs/api-p0.md) · [P0 修复说明](docs/p0-fixes.md)
MODULE_README.md 保留旧版开发记录；启动与当前行为以本说明和接口契约为准。
