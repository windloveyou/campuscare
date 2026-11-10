# SmartCampus 门户架构

SmartCampus 按团队提案提供统一入口、同一账号和差异化工作区。首页可以公开浏览服务目录与校园概念图；表单、记录和办理动作在登录后开放。项目背景是虚拟的 GlobalConnect University（GCU）。网页、内置演示资料和系统提示统一使用英文；已有的用户输入内容会原样保留。

| 提案子系统 | 本分支提供 | 团队集成边界 |
| --- | --- | --- |
| 学习支持 | 模块 1：带来源引用的校园问答；模块 2：透明的参与度风险提示 | 共用账号和活动记录，不授予额外业务权限 |
| 设施与资源 | 模块 3：设施、报修、派单、维修验收、巡检和合成数据预测实验；模块 4：场地预约、冲突检查、审批和通知 | 预约与维修分别维护独立状态 |
| 行政服务 | 模块 5：成绩单及在校证明申请、材料、人工审批、经办协作、进度、取消；模块 6：材料预审、修正、重提、决定和通知 | 两个申请模块保留独立数据表和业务流程 |

六个模块均已接入服务目录。保留后端既有的权限检查和 SQLite 数据，新增页面导航不授予额外权限。各模块按职责保持独立业务边界，共用登录、角色和事务基础层。

| 文件 | 职责 |
| --- | --- |
| `frontend/landing.js`、`frontend/little-wonders.css` | 基于 Little Wonders 源码的公开首页、照片轮播与相册、服务目录及移动端菜单 |
| `frontend/auth.js`、`frontend/portal.css` | 独立账号页面、角色选择、注册与密码找回 |
| `frontend/workspace.js`、`frontend/portal.css` | 服务配置、角色导航、运营和师生首页、服务搜索与工作区视觉 |
| `frontend/app.js` | 会话和页面路由。首页办理入口跳到 `#login?service=<key>`，登录后按权限直达所选业务；通用路径为 `#campus/<page>`，设施二维码仍支持 `?asset=<id>` |
| `frontend/ui.js` | 通用格式化、图标、抽屉和提示 |
| `frontend/motion.js`、`frontend/motion.css` | 首页分区入场、工作区切换、卡片与弹窗反馈；尊重减少动态效果设置 |
| `frontend/learning.js` | 模块 1 问答与来源、模块 2 学业风险提示 |
| `frontend/facilities.js` | 模块 3 设施业务页面、报修草稿、地图和维修操作 |
| `frontend/bookings.js` | 模块 4 场地可用性、申请和结果通知 |
| `frontend/admin-services.js` | 模块 5 行政业务页面，保留 `#admin-services` 路径和原接口 |
| `frontend/applications.js` | 模块 6 材料预审、修正、审核和通知 |
| `backend/` | 提供 API、数据迁移、事务和权限校验；本地演示时同时提供静态前端资源 |

首页基于 [uiuxlabz 的 Little Wonders GitHub 源码](https://github.com/uiuxlabz/kids-daycare-html-template/tree/ec899dd5d60b9d4b2255e71de5156bb33254d6ee) 改造；其 README 允许个人及商业使用，署名可选。沿用原模板的顶栏、导航、轮播、快捷栏、图文分栏、卡片和相册样式；替换演示内容与图片，接入 SmartCampus 的现有业务。第三方样式限定在公开首页，未引入模板原有的外链字体或外部请求。

首页校园图景为本项目生成的场景图，均以虚拟 GCU 为背景。轮播、概览、六张服务卡片及相册分别使用独立的 WebP 图片；轮播和服务卡片按屏幕比例裁切。站内将这些场景标记为概念图。

普通动效模式下，首页轮播每 5.5 秒自动切换，画面只展示照片。相册区提供首页轮播的播放和暂停入口。滚动时，图片在各自画框内轻微移动，图文与服务卡片依次入场，导航栏下方显示阅读进度。校园图景可在站内放大，支持方向键切换和 Esc 关闭。开启减少动态效果时，不自动播放轮播，也不启用滚动动效。

- `gcu-quadrangle.webp`：中央庭院与教学楼。
- `gcu-learning-commons.webp`：学生在共享学习空间合作。
- `gcu-campus-walk.webp`：学生沿校园步道走向教学区。

在项目代码目录运行 `python -B -m unittest discover` 检查接口，使用 Playwright 和本机 Chrome 运行浏览器验收脚本。测试使用临时数据库；单独执行设施浏览器流程时应把 `CAMPUSCARE_TEST_URL` 指到专用测试实例，因为该流程会创建并关闭真实的测试工单。
