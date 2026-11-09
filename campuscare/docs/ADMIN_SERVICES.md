# 行政服务 · 统一申请门户（模块 5）

## 演示

1. 用 `student` 登录，进入「行政服务」。从首页点「申请成绩单」或「申请在校证明」会打开已选好类型的申请表；「办理指南」可以展开查看常见问题。姓名、学号、班级、院系和邮箱会自动带入，可按需修改或补填。首次申请可附 PDF、PNG 或 JPG；每次最多 3 份，每份最多 2 MiB。
2. 在另一个浏览器窗口用 `admin` 登录，打开「行政服务 → 审批工作台」。首页的状态卡会跳到相应队列；也可以按编号、状态和类型查找。在详情页可核对本次填写的资料；与账号登记不同时会显示对应的登记值。可下载材料并通过、退回或驳回申请，退回和驳回需填写说明。
3. 学生可从首页状态卡或「我的申请」打开详情，查看办理进度、复制编号或补交材料。补交后自动回到「待审批」；原材料、补交材料和审批意见都保留。详情和列表支持直接访问、刷新及浏览器返回，从详情返回列表时会保留筛选条件。

两个演示账号的密码均为 `Campus2026!`。申请表的姓名和学号必填，其他三项选填。表单修改只保存到本次申请，不修改账号登记、登录邮箱或以前的申请。当前模块覆盖提交、人工审批和进度查询，审批通过代表业务状态更新；正式文件签发、智能预审和主动通知由独立模块衔接。

## 模块边界

| 文件 | 职责 |
| --- | --- |
| `admin_services.py` | 申请类型、角色范围、材料校验、状态流转、历史记录和数据表 |
| `web/admin-services.js`、`web/admin-services.css` | 学生申请、办理记录、补交和管理员审批，复用现有侧栏、卡片、抽屉和按钮 |
| `server.py`、`web/app.js`、`web/index.html` | 挂接模块路由、启动迁移、加载页面资源和增加导航；共用会话、CSRF、SQLite |
| `demo_accounts.py` | 演示账号的角色称呼和演示学生资料；启动时仅匹配并更新旧演示账号 |
| `test_admin_services.py`、`test_admin_services_browser.mjs` | 接口、数据、权限、浏览器流程和移动端验收 |

模块只新增 `admin_service_applications`、`admin_service_events`、`admin_service_materials` 三张表，与报修数据分开。启动时自动创建，已有数据不需要重建。申请保存提交时的资料快照；补交和审批同其历史记录在同一事务写入，版本号防止两位管理员覆盖同一决定。申请及附件按申请人或管理员权限读取；材料仅供下载，文件校验检查类型标记和大小，材料内容仍由管理员审核。

前端使用独立的 `#admin-services` 路径空间，子页分别为 `/apply`、`/records`、`/guide`、`/detail/{id}`。主工作台仅负责导航接入和恢复链接。

API 前缀为 `/api/admin-services`。`GET /catalog` 返回角色、选项和学生资料；`GET /summary` 返回当前角色有权访问的各状态数量及最近四条记录；`GET /applications` 支持 `status`、`type`、`q`（编号）和 `page` 查询；`POST /applications` 创建；`GET /applications/{id}` 获取详情；`POST /applications/{id}/decision` 或 `POST /applications/{id}/materials` 分别审批或补交，需附当前 `version`；`GET /applications/{id}/materials/{fileId}` 下载。以上路径均相对于此前缀。

## 团队合并

从 `feature/jt-work` 向团队的 `main` 发起合并请求。若其他成员同时接入模块，合并共用文件时保留双方的模块导入、迁移、资源和导航注册；业务逻辑留在各模块目录或文件中。模块 6 可基于申请编号和办理事件对接预审、通知，审批状态仍由本模块统一写入。

提案涉及的其他模块边界：学习支持含学习助手、学业预警；设施与资源含报修维护、场地预约；行政服务含统一申请、智能预审和通知。分工及验收以模块编号为准。

在代码目录验证：

```sh
python -m pip install -r requirements.txt
python -B -m unittest discover
node test_admin_services_browser.mjs
```

浏览器测试需要本机 Chrome 和 Node 可加载的 Playwright（如 `npm install --no-save --package-lock=false playwright`）。可用 `CAMPUSCARE_TEST_PYTHON` 指定 Python，可用 `CAMPUSCARE_BROWSER_CHANNEL=msedge` 改用 Edge。测试使用临时数据库；如设置 `CAMPUSCARE_TEST_ARTIFACTS`，会在指定目录保存学生、审批和手机端截图。
