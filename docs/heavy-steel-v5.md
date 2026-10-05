# 重工业管理工作台 V5

## 已应用

- 主页面上下滚动：上方空间总览，下方设备监测与人员管理，左侧导航在桌面保持可用。
- 按参考图加强金属边框：8–12 像素钢框、立体压边、四角内六角螺钉、金属按钮、琥珀色选中行；保留选定 Logo。
- 工地背景用于页眉和管理区侧栏。它是生成的装饰示意图片，非真实工地、BIM 或实时监控。
- 设备监测：设备编号/类型搜索，风险筛选，温度、负荷、状态，定位设备和详情。全部读取现有电气观测。
- 人员管理：人员编号搜索、有效/过期/高风险筛选、数据来源、采集时间、定位和详情。读取现有人员记录，不虚构姓名或考勤。
- 两个管理表独立折叠；手机宽度表格可横向滚动，页面本身不横向溢出。
- 演示模式保留地图与感知联动，暂时隐藏管理区；点击设备监测或人员管理会退出演示模式并跳到对应管理区。

## 使用

打开 http://127.0.0.1:18080/ 。点击左侧“设备监测”或“人员管理”直接跳转；点击模块标题折叠。列表中的定位会返回地图并显示对象详情。进入演示模式不会自动开始模拟。

验证：7 项前端回归测试通过；浏览器验证设备 D002 搜索定位、人员 P001 搜索定位、数据来源、模块折叠，以及 390 像素窄屏无页面横向溢出。后端业务规则未修改。修改尚未推送 GitHub。

人员管理本轮提供位置台账查询与风险跟踪，未新增人员增删、考勤或权限管理。原有真实定位、视频识别、BIM 与可通行路线的限制仍适用。

## 背景图生成记录

工具：内置 image_gen。项目素材：frontend/construction-bg.png。

提示词：Use case: photorealistic-natural. Asset: decorative wide construction site website background photograph for heavy industrial safety dashboard. Panoramic real-looking reinforced concrete building under construction, steel scaffolding, two tower cranes, exposed columns and structural beams, dusk overcast sky. Entire image in very dark desaturated charcoal steel gray, restrained amber construction lamps, high contrast architectural silhouettes. Left third quiet dark textured sky suitable for a logo overlay. Detailed realistic construction textures. No text, no logo, no UI frames, no workers closeup, no numbers, no watermarks. Professional architectural industrial photography, landscape wide composition. Decorative fictional site, not documentary.
