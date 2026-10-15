# 2026年10月15日发布说明

统一黑金机械风工作台、数字孪生与 GIS 直接切换，支持搜索展开分类、对象头像与分栏详情、导航收起、全屏和地图旁图层调节。

室内 A/B 与室外人员、车辆移动共用后台位置，停止和重置按所选路线作用于对应对象。三维点位按场景坐标锚定。

AI 自由提问采用基于后台证据的阿里云回答，设备状态与故障影响分别组织上下文，快捷按钮使用本地模板。归一化设备编号大小写和格式。工单创建、处理与复核仍执行后台岗位权限与版本核查。

验收：后台253项、47项子测试通过；前端68项通过。演示数据供功能操作体验。

部署模型环境变量：WORKFLOW_MODEL_ENABLED=1、WORKFLOW_MODEL_PROVIDER=aliyun、WORKFLOW_MODEL_NAME=qwen-plus、WORKFLOW_MODEL_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1、WORKFLOW_TEMPLATE_FIRST=1；密钥仅通过服务环境配置 WORKFLOW_MODEL_API_KEY 或 DASHSCOPE_API_KEY。源码及Docker上下文排除本机加密配置。
