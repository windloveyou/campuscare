# 合并到主系统

本仓库只交付 Module 1 与 Module 2。合并目标是在主仓库 `campuscare/` 中完成集成，
且改动集中在四处，避免产生冲突。

## 1. 资源冲突检查

| 资源 | 主系统 | 本仓库 | 处理方式 |
|---|---|---|---|
| 端口 | 8830 | 8840 | 合并后统一使用 8830 |
| Cookie 名称 | `campus_session` | `learning_session` | 合并后统一使用 `campus_session` |
| `users` 表 | 已存在 | 同名 | 保留主系统定义，本仓库只追加 `advisor` 列 |
| `sessions` 表 | 已存在 | 同名 | 保留主系统定义 |
| 业务表 | 无 | `kb_chunks`、`qa_logs`、`risk_*` | 执行 `modules/schema.sql` |
| 前端文件 | `app.js`、`style.css` | `learning.js`、`learning.css` | 新增文件，无冲突 |

## 2. 文件搬运

将以下内容复制到主仓库根目录（与 `server.py` 同级）：

```
campuscare/
├── core/            新增（db.py 可省略，改用主系统连接）
├── modules/         新增（含 schema.sql）
├── corpus/          新增
├── web/learning.js  新增
├── web/learning.css 新增
└── tests/           建议一并复制（support.py 已隔离临时库与临时语料）
```

## 3. 数据库

主系统已定义 `users` 与 `sessions`，不要复制 `core/db.py` 中的同名建表语句，
只执行业务表：

```python
# 在 campuscare/server.py 的 seed() 中追加
c.executescript((ROOT / "modules/schema.sql").read_text(encoding="utf-8"))
```

身份字段映射：

| 本仓库 | 主系统 | 处理方式 |
|---|---|---|
| `identity` = 学生 / 教师 / 系统管理员 | 同名字段已存在 | 直接复用；主系统原有的“校园管理人员”建议改称“行政人员” |
| `advisor`（所属教师 id） | 不存在 | `ALTER TABLE users ADD COLUMN advisor TEXT DEFAULT ''` |
| `student_no` | 已存在 | 复用 |

角色映射（不需要新增 role）：

| 五类身份 | 主系统 role | 说明 |
|---|---|---|
| 学生 | `user` | identity = 学生 |
| 教师 | `user` | identity = 教师，`advisor` 非空即为学业导师 |
| 行政人员 | `admin` | identity = 行政人员 |
| 维修人员 | `technician` | identity = 维修人员 |
| 系统管理员 | `admin` | identity = 系统管理员 |

权限判断统一使用 `identity`（`core/auth.py` 的 `is_student`、`is_teacher`、
`is_sysadmin`），不使用 `role`。若用 `role` 判断，行政人员与系统管理员会被当成
同一类高权限账号，违背角色分离要求。

## 4. 路由注册

主系统 `Handler.get` 与 `Handler.post` 采用顺序 `if` 分发，在末尾的 404 分支之前
插入路由匹配：

```python
from core.http import Router, Ctx, APIError
from modules import learning_qa, risk_warning, knowledge

ROUTER = Router()
ROUTER.include(learning_qa)
ROUTER.include(risk_warning)

# prepare() / seed() 之后
knowledge.load(ROOT / "corpus")

# Handler.get 内（post 同理，method 改为 POST）
handler, params = ROUTER.match("GET", path)
if handler:
    ctx = Ctx(c, u, query={k: v[0] for k, v in parse_qs(parsed.query).items()},
              params=params)
    self.respond(handler(ctx))
    return
```

模块内的 handler 只使用 `ctx.conn`、`ctx.user`、`ctx.body`、`ctx.query` 与
`ctx.params`，与主系统的 `c`（连接）和 `u`（用户字典）兼容。`APIError` 可替换为
主系统的同名异常，两者字段一致（`.message`、`.status`）。

## 5. 前端接入

主系统 `web/app.js` 的 `render()` 包含 `nav` 数组与 `views` 映射：

```js
const nav = [
  ['overview', 'grid', '工作台'],
  // ...
  u.identity === '系统管理员' ? null : ['qa', 'spark', '智能问答'],
  u.identity === '教师' ? ['risk', 'chart', '学业风险'] : null,
  u.identity === '学生' ? ['risk', 'chart', '我的学业画像'] : null,
  u.identity === '系统管理员' ? ['admin', 'box', '后台管理'] : null
].filter(Boolean);

const views = { /* ... */ qa: qaPage, risk: riskPage, admin: adminPage };

// bindPage() 内
if (page === 'qa') bindQA();
if (page === 'risk') state.capabilities.risk_advisor ? bindRisk() : bindSelf();
if (page === 'admin') bindAdmin();
```

从 `learning.js` 复制 `qaPage`、`riskPage`、`adminPage`、`bindQA`、`bindRisk`、
`bindSelf`、`bindAdmin` 等函数。这些函数只依赖 `$`、`esc`、`api`、`toast` 与
`state`，主系统均有同名实现；图标函数替换为主系统的 `icon()`。

`index.html` 增加两行：

```html
<link rel="stylesheet" href="/learning.css">
<script src="/learning.js" defer></script>
```

`learning.css` 直接沿用主系统的设计令牌与组件类（`--nav`、`--green`、`--paper`、
`.card`、`.stat`、`.badge`、`.drawer` 等），重名规则取值相同，可按以下任一方式处理：

1. 追加到 `style.css` 末尾（推荐，减少一次请求）；
2. 保留独立文件，在 `style.css` 之后加载。

新增选择器集中在问答与风险页面（`.chat`、`.bubble`、`.cite`、`.score-card`、
`.factor-table`、`.note`、`.modal`），不会覆盖主系统的同名规则。

## 6. 登录与账号

本仓库的登录页为独立运行而保留。合并后删除 `renderLogin`，在
`/api/bootstrap` 返回值中追加以下字段：

```
capabilities: { qa, risk_self, risk_advisor, admin }
model:         { configured, name }
knowledge:     { chunks, docs, min_score }
alert:         { threshold, cooldown_hours }
```

主系统 `users` 表需补充：

1. `ALTER TABLE users ADD COLUMN advisor TEXT DEFAULT ''`；
2. 将 `core/db.py` 的 `_seed_academic()` 改为 `seed_demo_students()`，仅在演示库
   执行一次（用 `WHERE NOT EXISTS` 保护）；
3. 演示账号对齐：`s2023001`（学生）、`teacher`（教师）、`sysadmin`（系统管理员，
   显示名即“系统管理员”）。

## 7. 合并检查清单

- [ ] `python -m unittest discover -s tests -t .` 全部通过
- [ ] 学生登录：`/api/qa/ask` 返回引用；`/api/risk/overview` 与 `/api/qa/knowledge` 返回 403
- [ ] 教师登录：仅返回 `advisor` 为本人账号的学生；`/api/admin/logs` 返回 403
- [ ] 系统管理员登录：`/api/qa/knowledge` 与 `/api/admin/logs` 正常；
      `/api/risk/overview` 返回 403；界面只有“后台管理”入口
- [ ] 主系统原有的报修、工单与用户管理页面功能不受影响
- [ ] 端口、Cookie 名称、表名三者无冲突
- [ ] 删除重复的 `users` 与 `sessions` 建表语句，仅保留主系统版本
