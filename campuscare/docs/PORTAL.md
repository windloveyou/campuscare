# SmartCampus 门户架构

门户按团队提案提供统一入口、同一账号和差异化工作区。首页可以公开浏览服务目录与校园实景；表单、记录和办理动作在登录后开放。示例校区为虚拟 GlobalConnect University（GCU），照片不表示这是伍伦贡大学的官方服务。

| 提案子系统 | 本分支提供 | 团队集成边界 |
| --- | --- | --- |
| 学习支持 | 由团队模块接入 | 智能问答与学业预警可作为独立导航项和页面接入 |
| 设施与资源 | 模块 3：设施、报修、派单、维修验收、巡检和合成数据预测实验 | 场地预约独立接入；不共用维修流程的状态 |
| 行政服务 | 模块 5：成绩单及在校证明申请、材料、人工审批、经办协作、进度、取消 | 模块 6 的智能预审和站内通知可接申请编号和办理事件 |

未合并的模块不出现在可办理的服务目录。保留后端既有的权限检查和 SQLite 数据，新增页面导航不授予额外权限。独立模块可按各自职责接入，避免在合并时重复更改登录或通用组件。

| 文件 | 职责 |
| --- | --- |
| `web/workspace.js`、`web/portal.css` | 公开首页、服务目录、角色导航、运营和师生首页、服务搜索与网站视觉 |
| `web/app.js` | 会话、登录后直达、路由和页面装载。通用路径为 `#campus/<page>`；设施二维码仍支持 `?asset=<id>` |
| `web/ui.js` | 通用格式化、图标、抽屉和提示 |
| `web/facilities.js` | 设施业务页面、报修草稿、地图和维修操作 |
| `web/admin-services.js` | 行政业务页面，保留 `#admin-services` 路径和原接口 |
| `server.py` | 提供本地页面资源，继续校验各业务接口的权限 |

首页参考[模板王的演示](https://www.mobanwang.com/mb/demo/23175/)，自行实现布局和交互。校园照片由 Wikimedia Commons 提供，按 [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) 使用。下列副本转换为 WebP，前两张缩小到 1920 像素宽，轮播按屏幕比例裁切；图片副本继续使用原许可。首页每张照片均显示来源与许可链接。

- `uow-mckinnon.webp`：[伍伦贡大学麦金农楼](https://commons.wikimedia.org/wiki/File:Uni_of_Wollongong_McKinnon_building.JPG)，JVPurvis。
- `uow-science.webp`：[伍伦贡大学科学楼群](https://commons.wikimedia.org/wiki/File:Uni_of_Wollongong_Science_buildings.JPG)，JVPurvis。
- `uow-smart.webp`：[伍伦贡大学 SMART 基础设施研究楼](https://commons.wikimedia.org/wiki/File:UOW_Smart_Infrastructure_Facility.jpg)，Nikita Sergey。

在项目代码目录运行 `python -B -m unittest discover` 检查接口，使用 Playwright 和本机 Chrome 运行浏览器验收脚本。测试使用临时数据库；单独执行设施浏览器流程时应把 `CAMPUSCARE_TEST_URL` 指到专用测试实例，因为该流程会创建并关闭真实的测试工单。
