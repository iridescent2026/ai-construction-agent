# 工安智瞳 · 电气风险模块

当前模块实现与 V18 整合版一致；此次同步共享观测时间校验，非字符串时间戳按未知/过期处理。
保留本分支原有根目录 `main.py` 和目录结构。完整界面与联合演示请使用 main 分支。

```powershell
python -m pip install -r requirements.txt
python -m uvicorn main:app --host 127.0.0.1 --port 8001
```

接口文档：http://127.0.0.1:8001/docs 。完整启动方式：在 main 分支运行 `python run_demo.py`。

电气状态查询只读，`/telemetry` 与 `/simulation/tick` 才会更新观测。单项危险优先，不以加权结果稀释；演示阈值尚未进行现场设备适用性核验。

[当前接口契约](docs/api-p0.md) · [P0 修复说明](docs/p0-fixes.md)
MODULE_README.md 保留旧版开发记录；启动与当前行为以本说明和接口契约为准。
