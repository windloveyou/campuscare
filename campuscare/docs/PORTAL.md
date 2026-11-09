# SmartCampus 门户架构

门户按团队提案提供统一入口、同一账号和差异化工作区。首页可以公开浏览服务目录与校园概念图；表单、记录和办理动作在登录后开放。项目背景是虚拟的 GlobalConnect University（GCU）。

| 提案子系统 | 本分支提供 | 团队集成边界 |
| --- | --- | --- |
| 学习支持 | 由团队模块接入 | 智能问答与学业预警可作为独立导航项和页面接入 |
| 设施与资源 | 模块 3：设施、报修、派单、维修验收、巡检和合成数据预测实验 | 场地预约独立接入；不共用维修流程的状态 |
| 行政服务 | 模块 5：成绩单及在校证明申请、材料、人工审批、经办协作、进度、取消 | 模块 6 的智能预审和站内通知可接申请编号和办理事件 |

未合并的模块不出现在可办理的服务目录。保留后端既有的权限检查和 SQLite 数据，新增页面导航不授予额外权限。独立模块可按各自职责接入，避免在合并时重复更改登录或通用组件。

| 文件 | 职责 |
| --- | --- |
| `web/landing.js`、`web/little-wonders.css` | 基于 Little Wonders 源码的公开首页、照片轮播与相册、登录表单及移动端菜单 |
| `web/workspace.js`、`web/portal.css` | 服务配置、角色导航、运营和师生首页、服务搜索与工作区视觉 |
| `web/app.js` | 会话、登录后直达、路由和页面装载。通用路径为 `#campus/<page>`；设施二维码仍支持 `?asset=<id>` |
| `web/ui.js` | 通用格式化、图标、抽屉和提示 |
| `web/facilities.js` | 设施业务页面、报修草稿、地图和维修操作 |
| `web/admin-services.js` | 行政业务页面，保留 `#admin-services` 路径和原接口 |
| `server.py` | 提供本地页面资源，继续校验各业务接口的权限 |

首页基于 [uiuxlabz 的 Little Wonders GitHub 源码](https://github.com/uiuxlabz/kids-daycare-html-template/tree/ec899dd5d60b9d4b2255e71de5156bb33254d6ee) 改造；其 README 允许个人及商业使用，署名可选。沿用原模板的顶栏、导航、轮播、快捷栏、图文分栏、卡片、表单和相册样式；替换演示内容、图片和模拟表单，接入 CampusCare 已有业务。第三方样式限定在公开首页，未引入模板原有的外链字体或外部请求。

首页校园图景为本项目生成的场景图，均以虚拟 GCU 为背景。图片转换成 WebP 本地提供；轮播和服务卡片按屏幕比例裁切。站内将这些场景标记为概念图。

- `gcu-quadrangle.webp`：中央庭院与教学楼。
- `gcu-learning-commons.webp`：学生在共享学习空间合作。
- `gcu-campus-walk.webp`：学生沿校园步道走向教学区。

在项目代码目录运行 `python -B -m unittest discover` 检查接口，使用 Playwright 和本机 Chrome 运行浏览器验收脚本。测试使用临时数据库；单独执行设施浏览器流程时应把 `CAMPUSCARE_TEST_URL` 指到专用测试实例，因为该流程会创建并关闭真实的测试工单。
