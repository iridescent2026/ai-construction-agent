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

## 2026-10-13：旧版数学成果迁移

此更新基于远端 math 的 `642ffaa`，保留根目录 `main.py`、共享代码、真实快照/过期处理、
实际工具调用和大模型配置接口。旧版完整工程留在本地 `backup/math-local-before-sync-20261013`，
旧前端、GIS、电气及统一启动器不复制到此独立数学分支。完整界面仍应使用 main 集成版。

迁入的数学改动：

- `/route` 新增可选 `risk_priority_weight`（0～20 的整数）。默认 0，保持新版已有调用只优化距离；
  显式设为 5 时兼顾距离与风险尽早巡检，不保证严格按风险排序。
- 新增 `stops`：每站规划时风险、分段距离、累计距离和出发后预计到达时间，包含最终回程。
  新增风险等待指标与优化代价，保留 `solver`、`route_type`、`walkability_verified=false` 等既有字段。
- 非法坐标、空白编号、NaN/Infinity 请求返回可序列化的 422；两点距离在对跖点附近保持有效。
- 综合风险校验来源评分，保留原始精度与新版 `data_complete`/未知状态；缺失来源不当作安全数据。
  处置建议区分空间、电气及双方高风险，同时保留快照编号和 GIS revision。
- 支持最高设备/区域风险查询和并列结果；未知或过期观测不参加设备最高风险比较，存在未知状态时明确限定结论。
- 缺少模型密钥的通用 `/chat_llm` 请求返回明确配置提示，明确路线和电气查询仍直接执行工具。

### 验证与复现实验

依赖安装后，在本分支根目录运行：

```powershell
python -m unittest discover -s tests -p "test_*.py"
```

既有 PostgreSQL 适配器测试使用 pytest：`python -m pytest tests/test_postgres_adapter.py`。
上述数学测试使用内存日志库、模拟上游响应和模型调用，不访问真实数据库或付费模型。
真实 DeepSeek 调用及完整 main 的界面集成需要单独验收，不计入本次本地迁移验证。
本次本地结果：39 项数学接口测试和既有 PostgreSQL 事务回归通过；独立 HTTP 服务的默认距离模式、
风险模式、优化指标及 `/chat`、`/chat_llm` 的实际路线工具调用验证通过，未调用付费模型。

启动数学服务后运行 `python examples/compare_routes.py`，对同一固定点集分别使用权重 5 和 0。
输出含输入快照及完整到达明细；不同权重的优化代价不可直接比较，应比较总距离和风险加权等待距离。
路线仍是点间直线顺序，未校验现场通路；时间按 60 米/分钟估算，不含检查停留时间。

### 后续集成

此提交只更新独立 math 分支。向完整 main 同步时，数学源码对应 `math/main.py`，
测试需按 main 的模块导入方式调整；应保留 main 中已经新增的功能，不能用整个旧工程覆盖。
旧版界面的偏好比较、导出与快照显示留在备份分支，可在 main 前端的单独变更中参考。
