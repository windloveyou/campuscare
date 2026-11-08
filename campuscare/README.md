# CampusCare · 校园设施维护

CSIT883 / Huang Tianze / Module 3 的本地课程项目。覆盖虚拟 GCU 校区、三类权限、设施台账、图文报修入口、维修流程、管理看板及合成数据上的故障预测实验。

## 启动

需要 Python 3.9 或更新版本。前端无需 Node 构建，不加载外部字体、地图或 CDN。

```sh
git clone https://github.com/windloveyou/campuscare.git
cd campuscare
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -B server.py
```

打开 http://127.0.0.1:8830 。默认只监听本机。首次启动生成 `data/campuscare.sqlite3`，后续启动保留数据。退出终端后可用相同命令重新启动。

演示密码统一为 `Campus2026!`。这是一套本地课程演示账号，不应原样公开部署。

| 账号 | 身份 | 权限 |
|---|---|---|
| student | 林同学 / 学生 | 公共设施及 D1-201 宿舍、自己的工单和关注工单 |
| teacher | 陈老师 / 教师 | 公共设施、自己的工单和关注工单 |
| tech | 王师傅 / 电工 | 指派给自己的维修工单 |
| plumber | 李师傅 / 水务 | 指派给自己的维修工单 |
| it | 赵工程师 / IT | 指派给自己的维修工单 |
| admin | 黄天泽 / 管理人员 | 全校设施、工单、派单、巡检及统计 |

## 当前完成范围

- 校园示意地图：2 栋教学楼、6 间教室、2 栋宿舍的 12 间宿舍及公共区域、3 条道路和维修服务点；119 项模拟设施。
- 地图区域/房间下钻、设施搜索、设施编号入口、可扫描的报修二维码。
- 管理员登记新设施、编辑名称与位置补充、停用/恢复设施；新登记设施不自动显示正常。
- 真实浏览器定位接口：需要授权；虚拟校区不与 GPS 强行匹配。
- 持久化 SQLite 数据库、密码 PBKDF2 哈希、12 小时会话、CSRF 校验、后端角色权限。
- 文字与图片报修；浏览器压缩照片并保存在本机数据库，不发往外部服务。
- 管理员用户管理：分页搜索、创建账号、编辑资料、角色分配、宿舍授权、停用/恢复、密码重置和审计记录。
- 规则辅助：问题归类、必要补问、工单草稿、同设施重复报修候选。界面明确标识模式。
- 完整工单流程：待确认 → 派单 → 维修 → 等待配件/继续维修 → 验收 → 完成；支持补充、改派、重新打开和待确认阶段取消。
- 乐观并发版本检查和状态操作审计记录。
- 设备状态由全部未完成工单和检查记录派生；关闭一条工单不会清除其他未解决问题。
- 管理看板、受控数据库问答、巡检创建与完成。
- 可复现的合成事件预测实验：逻辑回归对比近期报修次数基线；少于 3 条历史记录不评估。

## AI 的真实边界

用户已选择先体验规则辅助，模型接入下一步再定。当前不安装或下载大模型，也不声称规则输出是 AI 视觉诊断。

预留 Ollama `/api/chat` 接口。后续选定并安装支持图像的模型后：

```sh
CAMPUSCARE_OLLAMA_URL=http://127.0.0.1:11434 \
CAMPUSCARE_MODEL=你的实际模型名称 \
.venv/bin/python -B server.py
```

接口按 Ollama 官方格式传递文字及 base64 图片，使用 JSON 输出。调用失败明确退回规则辅助；模型的内部故障结论始终需要人工核查。默认候选名 `qwen3.5:0.8b` 不表示此模型已经安装或验证。

参考：
- https://docs.ollama.com/api/chat
- https://docs.ollama.com/capabilities/vision
- https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API

现阶段不包括：语义向量检索、图像相似度匹配、照片门牌 OCR 定位、自动派单、自由式管理问答、真实数据训练的故障预测。地点搜索为台账关键词匹配，重复工单使用同设备约束与字符双字相似度。以上都作为后续可替换模块，而不是假装已实现。

## 数据与隐私

### 管理员用户管理

管理员从左侧“用户管理”进入，可分页查询、新建账号、编辑姓名及校园资料、调整角色、分配已核实的宿舍、停用/恢复账号和重置密码。所有操作有审计记录；修改后撤销目标用户旧会话。不能停用自己或撤销自己的管理员身份；有未完成任务的维修人员需先完成移交或验收。详见 [用户管理说明](docs/USER_MANAGEMENT.md)。

### 注册与邮箱找回密码

登录页现在支持输入用户名或注册邮箱，以及“注册”和“忘记密码”入口。注册字段包括姓名、学生/教师身份、用户名、学号/工号、班级、院系、邮箱、密码。学生必须填写班级，邮箱需验证码验证；自助注册仅生成普通用户，不授予管理员、维修人员或私人宿舍权限。登录后点击顶部“个人资料”可核对保存的信息。

数据库启动时自动增量迁移，保留现有账号、密码哈希、工单及照片。运行数据库及本机备份不包含在源码仓库内。

密码以每用户随机盐的 PBKDF2-SHA256 哈希保存。验证码也是加盐哈希，10分钟有效、单次使用、最多5次错误尝试，同一邮箱同一用途60秒后可重发；IP有发送频率限制。重发使上一验证码失效，密码重置使该账号所有旧会话失效。

**本机体验（不发邮件）：**

```sh
CAMPUSCARE_MAIL_MODE=demo .venv/bin/python -B server.py
```

本机演示模式在页面显示测试验证码，并明确写明“未发送邮件”。仅允许 loopback 客户端；不能用于公开部署。默认未设置邮件模式时为 `disabled`，不会悄悄暴露验证码。

**真实邮件（推荐在页面设置）：** 在本机打开系统，以管理员登录（演示账号 `admin`，密码 `Campus2026!`），点击顶部“邮件服务”。选择 QQ、163 或 Gmail，填写一个发件邮箱及其授权码/应用专用密码，点击“保存并启用邮件发送”，再向自己的邮箱发送测试邮件。保存即时生效，无需重启。一个发件账号即可向 Gmail、QQ、163 等邮箱发送验证码，收件用户不需要开启 SMTP。

授权码获取步骤、服务商入口和失败原因提示都在页面内；详细说明见 [邮件配置指南](docs/EMAIL_SETUP.md)。配置保存在 `data/mail-settings.json`（权限0600，已排除版本控制），接口不回传授权码。设置入口仅允许本机管理员访问，并校验 CSRF；测试发信最多5次/5分钟。切换邮件配置会使未使用的旧验证码失效。停用服务会清除已保存授权码，不会切回页面展示验证码的演示模式。

**环境变量方式（可选）：** 没有页面保存的配置时，也可将 `CAMPUSCARE_MAIL_MODE` 设置为 `smtp`，并在服务进程环境中设置以下配置（参见 `.env.example`；项目不会自动读取 `.env`）。页面保存的配置优先于环境变量：

| 环境变量 | 含义 |
|---|---|
| CAMPUSCARE_SMTP_HOST | 邮件服务SMTP主机 |
| CAMPUSCARE_SMTP_PORT | 465（SSL）或587（STARTTLS） |
| CAMPUSCARE_SMTP_TLS | `ssl` 或 `starttls`，不支持明文发送 |
| CAMPUSCARE_SMTP_FROM | 发件邮箱 |
| CAMPUSCARE_SMTP_USER | SMTP登录名 |
| CAMPUSCARE_SMTP_PASSWORD | 邮件服务授权码/应用密码，私下配置，不提交源码 |

SMTP 模式不在页面返回验证码；发送失败会显示错误，不伪装成功。目前未配置真实SMTP，邮件投递只做了模拟测试，需后续使用实际邮件服务验证。未实现短信验证码，避免引入短信平台和付费依赖。已有演示账号没有绑定邮箱，因此不能通过邮箱找回；可新注册账号体验完整流程。

相关接口：`GET /api/auth/options`、`POST /api/auth/code`、`POST /api/auth/register`、`POST /api/auth/reset`；管理员邮件设置 `GET/POST /api/mail/settings`、测试发信 `POST /api/mail/test`。测试命令：`.venv/bin/python -B -m unittest -v test_system test_accounts test_mail test_users`。`test_accounts_browser.mjs`、`test_mail_browser.mjs`、`test_users_browser.mjs` 使用独立临时数据库验证浏览器流程，不污染演示用户数据；邮件验收脚本使用模拟 SMTP，不实际发信。

实现参考：[OWASP 密码找回流程](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)、[Python SMTP 文档](https://docs.python.org/3/library/smtplib.html)。

所有初始位置、设施、工单和维护历史均为课程模拟。新报修为用户当前录入，单独标识；上传图片只有工单有权访问者可读取。普通用户无法访问其他宿舍内部设施及私人报修。

数据库包含本地上传的照片、会话和工单，已由 `.gitignore` 排除。备份请在服务停止时复制整个 `data/` 文件夹。不要把含个人照片的数据库作为公开项目源码发布。

手机二维码需服务在手机可达地址运行，可设置 `HOST` 和 `CAMPUSCARE_PUBLIC_URL`；本机默认生成的 `127.0.0.1` 链接仅本机可达。公共部署还需要 HTTPS、正式账号管理、登录限速和部署级安全配置，本版不直接面向互联网。

## 测试

```sh
.venv/bin/python -B -m unittest -v test_system test_accounts test_mail test_users
.venv/bin/python -B forecast.py
```

后端测试使用临时数据库及独立端口，不修改演示数据库。覆盖登录、CSRF、宿舍访问控制、工单状态、指派权限、并发冲突、重复报修关注、附件访问、二维码、巡检和预测时间泄漏。

`test_browser.mjs` 是可选的真实浏览器验收脚本，需要 Node、Playwright 和 Chrome。使用独立浏览器配置，不读取个人 Chrome 数据；运行时会在目标数据库留下明确命名的“浏览器验收”已完成工单。

```sh
# 安装 Playwright 的开发环境下，先启动服务，再运行：
node test_browser.mjs
```

## 目录

```text
server.py          HTTP API、SQLite、角色权限、规则辅助与模型适配
forecast.py        可复现的合成数据预测实验
web/               无构建依赖的页面、交互、校园 SVG 地图
test_system.py     HTTP 集成测试
test_browser.mjs   桌面/手机页面与三角色流程验收
docs/              设计说明、接口、演示步骤与验收记录
artifacts/         浏览器验收截图
data/              运行时 SQLite（不提交）
```

项目定位：可运行的课程原型。预测实验、初始校园和维护历史均不代表真实校园数据或实际预测性能。

## 源码与运行数据

公开仓库包含代码、配置示例、自动化测试和文档；不包含运行数据库、邮箱授权码、照片、登录会话、浏览器截图、虚拟环境或本机备份。首次运行由程序生成模拟校区数据；真实录入信息保存在本机 `data/`。`artifacts/` 为本地测试输出，运行浏览器验收脚本后生成。
