"""Module 2 · Academic Risk Warning（学业风险预警）

定位：可解释的规则引擎，不是机器学习模型。
- 四个因子各自有阈值、权重和证据文本，任何人都能手工复算分数；
- 数据不足的因子会被剔除并重新归一化权重，覆盖率低于 40% 时不给等级；
- 分数达到自动预警阈值时，系统同时向学生本人与其学业导师发送通知；
- 依据《学业进度与学业预警管理办法》第 2、3 条设定触发情形与三级预警。
"""

import json
from datetime import datetime

from core.http import APIError, clamp

# 权重之和为 1.0；evidence 文本会直接展示给学生和导师，必须能对应回原始记录
FACTORS = [
    {
        "key": "submission",
        "name": "作业按时提交",
        "weight": 0.30,
        "window": "近 21 天",
        "rule": "按时提交率 95% 为满分基线，低于 40% 记满风险",
    },
    {
        "key": "grade",
        "name": "成绩趋势",
        "weight": 0.30,
        "window": "全部已出分考核",
        "rule": "近三次均分较此前下降 20 分，或均分低于 60 分",
    },
    {
        "key": "engagement",
        "name": "平台登录次数",
        "weight": 0.20,
        "window": "近 14 天",
        "rule": "14 天内登录 10 次为基线，0 次记满风险",
    },
    {
        "key": "participation",
        "name": "智能问答次数",
        "weight": 0.20,
        "window": "近 14 天",
        "rule": "14 天内使用智能问答 3 次为基线",
    },
]

ACTIONS = {
    "submission": [
        "与导师确认是否有未申报的延期申请",
        "查看作业截止日与权重，重排本周学习计划",
        "预约学习支持中心的作业规划辅导",
    ],
    "grade": [
        "预约该课程的朋辈辅导，针对薄弱考核点复习",
        "与授课教师确认评分标准与失分点",
        "申请成绩复核（成绩公布后 10 个工作日内）",
    ],
    "engagement": [
        "检查课程平台通知与未读消息",
        "与导师进行一次 30 分钟学业面谈",
    ],
    "participation": [
        "使用智能问答助手确认课程与考核规则",
        "预约学习策略工作坊",
    ],
}

LEVELS = [(60, "high", "高风险"), (35, "watch", "关注"), (0, "low", "正常")]
LOW_COVERAGE = 0.4

# 自动预警：分数达到该值时，系统同时通知学生与其学业导师
AUTO_ALERT_SCORE = 60.0
ALERT_COOLDOWN_HOURS = 168  # 同一学生同一等级每周最多提醒一次


# ------------------------------------------------------------------ 因子计算


def _submission(conn, sid):
    row = conn.execute(
        "SELECT count(*) total, sum(on_time) on_time FROM risk_records "
        "WHERE student_id=? AND due BETWEEN date('now','-21 day') AND date('now')",
        (sid,),
    ).fetchone()
    total, on_time = row["total"] or 0, row["on_time"] or 0
    if total < 3:
        return False, 0.0, f"近 21 天仅 {total} 项考核到期，样本不足", f"{on_time}/{total}"
    rate = on_time / total
    risk = clamp((0.95 - rate) / 0.55)
    return (
        True,
        risk,
        f"近 21 天应完成 {total} 项，按时提交 {on_time} 项（{rate:.0%}）",
        f"{on_time}/{total}",
    )


def _grade(conn, sid):
    rows = conn.execute(
        "SELECT score, due, course_code, assessment FROM risk_records "
        "WHERE student_id=? AND score IS NOT NULL ORDER BY due DESC",
        (sid,),
    ).fetchall()
    if len(rows) < 3:
        return False, 0.0, f"仅有 {len(rows)} 条已出分记录，不足以判断趋势", "—"
    recent = [r["score"] for r in rows[:3]]
    prior = [r["score"] for r in rows[3:6]] or recent
    recent_avg = sum(recent) / len(recent)
    prior_avg = sum(prior) / len(prior)
    drop = prior_avg - recent_avg
    trend_risk = clamp(drop / 20)
    level_risk = clamp((60 - recent_avg) / 25)
    risk = max(trend_risk, level_risk)
    if drop >= 1:
        detail = (
            f"近三次均分 {recent_avg:.1f}，此前 {prior_avg:.1f}，下降 {drop:.1f} 分"
        )
    else:
        detail = f"近三次均分 {recent_avg:.1f}，此前 {prior_avg:.1f}，基本持平或上升"
    return True, risk, detail, f"{recent_avg:.1f}/{prior_avg:.1f}"


def _activity(conn, sid, column, days=14):
    row = conn.execute(
        f"SELECT coalesce(sum({column}),0) AS total, count(*) AS days "
        f"FROM risk_activity WHERE student_id=? AND day>=date('now',?)",
        (sid, f"-{days - 1} day"),
    ).fetchone()
    return row["total"] or 0, row["days"] or 0


def _engagement(conn, sid):
    total, days = _activity(conn, sid, "logins")
    if days < 3:
        return False, 0.0, "缺少平台登录记录", "—"
    risk = clamp((10 - total) / 10)
    return True, risk, f"近 14 天平台登录 {total} 次（基线 10 次）", f"{total} 次"


def _participation(conn, sid):
    total, days = _activity(conn, sid, "qa_asks")
    if days < 3:
        return False, 0.0, "缺少问答使用记录", "—"
    risk = clamp((3 - total) / 3)
    return True, risk, f"近 14 天使用智能问答 {total} 次（基线 3 次）", f"{total} 次"


CALCULATORS = {
    "submission": _submission,
    "grade": _grade,
    "engagement": _engagement,
    "participation": _participation,
}


def _level(score, coverage):
    if coverage < LOW_COVERAGE:
        return "unknown", "数据不足"
    for threshold, key, label in LEVELS:
        if score >= threshold:
            return key, label
    return "low", "正常"


def assess(conn, student_id):
    """计算单个学生的风险分。返回结构化结果，不做任何写库操作。"""
    student = conn.execute(
        "SELECT s.id,s.name,s.program,s.advisor,s.student_no,t.name AS advisor_name "
        "FROM users s LEFT JOIN users t ON s.advisor=t.id "
        "WHERE s.id=? AND s.identity='学生'",
        (student_id,),
    ).fetchone()
    if not student:
        raise APIError("学生不存在", 404)

    factors, coverage = [], 0.0
    for spec in FACTORS:
        sufficient, risk, detail, evidence = CALCULATORS[spec["key"]](conn, student_id)
        if sufficient:
            coverage += spec["weight"]
        factors.append(
            {
                "key": spec["key"],
                "name": spec["name"],
                "weight": spec["weight"],
                "window": spec["window"],
                "rule": spec["rule"],
                "risk": round(risk, 3),
                "evidence": evidence,
                "detail": detail,
                "sufficient": sufficient,
                "action": (ACTIONS[spec["key"]][0] if risk >= 0.5 else ""),
            }
        )

    if coverage > 0:
        raw = sum(f["weight"] * f["risk"] for f in factors if f["sufficient"])
        score = round(raw / coverage * 100, 1)
    else:
        score = 0.0

    for f in factors:
        f["contribution"] = (
            round(f["weight"] * f["risk"] / coverage * 100, 1)
            if f["sufficient"] and coverage
            else 0.0
        )

    level, level_label = _level(score, coverage)
    driver = max(
        (f for f in factors if f["sufficient"]),
        key=lambda f: f["contribution"],
        default=None,
    )
    # 正常状态下不点名"主导因素"，避免把无关紧要的项说成问题
    if level == "low" and driver and driver["risk"] < 0.5:
        driver_name, driver_detail = "无明显风险因素", "四项指标均在基线范围内"
    else:
        driver_name = driver["name"] if driver else ""
        driver_detail = driver["detail"] if driver else ""
    actions = []
    for f in sorted(
        (f for f in factors if f["sufficient"] and f["risk"] >= 0.5),
        key=lambda f: -f["contribution"],
    ):
        for action in ACTIONS[f["key"]]:
            if action not in actions:
                actions.append(action)
        if len(actions) >= 3:
            break

    return {
        "student_id": student["id"],
        "name": student["name"],
        "program": student["program"],
        "advisor": student["advisor"],
        "advisor_name": student["advisor_name"] or "",
        "student_no": student["student_no"],
        "score": score,
        "level": level,
        "level_label": level_label,
        "coverage": round(coverage, 2),
        "driver": driver_name,
        "driver_detail": driver_detail,
        "factors": factors,
        "actions": actions[:3],
        "missing": [f["name"] for f in factors if not f["sufficient"]],
        # 教师端的"参与度"：近 14 天的登录与提问次数，原样展示不做加权
        "activity": {
            "window": "近 14 天",
            "logins": _activity(conn, student_id, "logins")[0],
            "qa_asks": _activity(conn, student_id, "qa_asks")[0],
        },
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "data_source": "synthetic",
    }


def save(conn, result):
    conn.execute(
        "INSERT INTO risk_snapshots(student_id,created,score,level,coverage,factors,actions) "
        "VALUES(?,?,?,?,?,?,?)",
        (
            result["student_id"],
            result["generated_at"],
            result["score"],
            result["level"],
            result["coverage"],
            json.dumps(result["factors"], ensure_ascii=False),
            json.dumps(result["actions"], ensure_ascii=False),
        ),
    )
    return conn.execute("SELECT last_insert_rowid()").fetchone()[0]


def history(conn, student_id, limit=8):
    rows = conn.execute(
        "SELECT created,score,level FROM risk_snapshots WHERE student_id=? "
        "ORDER BY id DESC LIMIT ?",
        (student_id, limit),
    ).fetchall()
    return [dict(r) for r in reversed(rows)]


# ------------------------------------------------------------------ 角色视图


def _visible_students(conn, user):
    """可见范围：教师只见本人名下学生，学生只见自己，其他角色（含系统管理员）无权。"""
    if user["identity"] == "教师":
        return conn.execute(
            "SELECT id,name,program,advisor FROM users "
            "WHERE identity='学生' AND advisor=? ORDER BY id",
            (user["id"],),
        ).fetchall()
    if user["identity"] == "学生":
        return conn.execute(
            "SELECT id,name,program,advisor FROM users WHERE id=? AND identity='学生'",
            (user["id"],),
        ).fetchall()
    return []


def _require_teacher(user):
    if user["identity"] != "教师":
        raise APIError("学业预警面向任课教师/学业导师，其他角色无权访问", 403)


def listing(ctx):
    user = ctx.user
    if user["identity"] == "学生":
        raise APIError("学生请使用「我的学业画像」页面", 403)
    _require_teacher(user)
    students = _visible_students(ctx.conn, user)
    items = []
    for row in students:
        result = assess(ctx.conn, row["id"])
        snaps = history(ctx.conn, row["id"], 2)
        result["previous"] = snaps[0]["score"] if len(snaps) > 1 else None
        result["unread"] = ctx.conn.execute(
            "SELECT count(*) FROM risk_notes WHERE student_id=? AND recipient=? AND read_at IS NULL",
            (row["id"], user["id"]),
        ).fetchone()[0]
        items.append(result)

    total = len(items) or 1
    counts = {"high": 0, "watch": 0, "low": 0, "unknown": 0}
    for item in items:
        counts[item["level"]] = counts.get(item["level"], 0) + 1
    driver_tally = {}
    for item in items:
        if item["level"] in ("high", "watch") and item["driver"]:
            driver_tally[item["driver"]] = driver_tally.get(item["driver"], 0) + 1

    return {
        "items": sorted(items, key=lambda i: -i["score"]),
        "counts": counts,
        "average": round(sum(i["score"] for i in items) / total, 1),
        "drivers": sorted(
            ({"name": k, "count": v} for k, v in driver_tally.items()),
            key=lambda d: -d["count"],
        ),
        "thresholds": {"high": 60, "watch": 35},
        "data_source": "synthetic",
        "disclaimer": (
            "成绩、提交与活跃记录均为课程演示用的合成数据，不代表任何真实学生。"
        ),
    }


def detail(ctx):
    sid = ctx.params["student_id"]
    user = ctx.user
    allowed = {row["id"] for row in _visible_students(ctx.conn, user)}
    if sid not in allowed:
        raise APIError("无权查看该学生的预警记录", 403)

    result = assess(ctx.conn, sid)
    result["history"] = history(ctx.conn, sid)
    result["records"] = [
        dict(r)
        for r in ctx.conn.execute(
            "SELECT course_code,course_name,assessment,weight,due,submitted,score,on_time "
            "FROM risk_records WHERE student_id=? ORDER BY due DESC LIMIT 15",
            (sid,),
        )
    ]
    result["notes"] = [
        dict(r)
        for r in ctx.conn.execute(
            "SELECT id,kind,level,score,title,body,author,created,read_at FROM risk_notes "
            "WHERE student_id=? AND recipient_role='student' ORDER BY id DESC LIMIT 10",
            (sid,),
        )
    ]
    return result


def me(ctx):
    if ctx.user["identity"] != "学生":
        raise APIError("该接口面向学生账号", 403)
    result = assess(ctx.conn, ctx.user["id"])
    result["history"] = history(ctx.conn, ctx.user["id"])
    result["notes"] = [
        dict(r)
        for r in ctx.conn.execute(
            "SELECT id,kind,level,score,title,body,author,created,read_at FROM risk_notes "
            "WHERE recipient=? ORDER BY id DESC LIMIT 10",
            (ctx.user["id"],),
        )
    ]
    return result


def scan(ctx):
    _require_teacher(ctx.user)
    students = _visible_students(ctx.conn, ctx.user)
    saved, alerts = [], []
    for row in students:
        result = assess(ctx.conn, row["id"])
        save(ctx.conn, result)
        alerts.extend(alert_if_needed(ctx.conn, result))
        saved.append(
            {
                "student_id": row["id"],
                "name": result["name"],
                "score": result["score"],
                "level": result["level"],
            }
        )
    ctx.conn.commit()
    return {"scanned": len(saved), "items": saved, "alerts": len(alerts)}


# ------------------------------------------------------------------ 自动预警


def _auto_sent(conn, student_id, level):
    """同一学生同一等级在冷却期内只通知一次，避免每次扫描重复打扰。"""
    row = conn.execute(
        "SELECT 1 FROM risk_notes WHERE student_id=? AND level=? AND kind='auto' "
        "AND created >= datetime('now','localtime',?)",
        (student_id, level, f"-{ALERT_COOLDOWN_HOURS} hours"),
    ).fetchone()
    return row is not None


def _insert_note(conn, **kw):
    conn.execute(
        "INSERT INTO risk_notes(student_id,recipient,recipient_role,kind,level,score,"
        "author,title,body,created) VALUES(?,?,?,?,?,?,?,?,?,datetime('now','localtime'))",
        (
            kw["student_id"],
            kw["recipient"],
            kw["recipient_role"],
            kw["kind"],
            kw["level"],
            kw["score"],
            kw["author"],
            kw["title"],
            kw["body"],
        ),
    )


def alert_if_needed(conn, result):
    """分数达到阈值时，同时给学生和其学业导师写入一条通知。返回新建条数。"""
    if result["level"] != "high" or result["score"] < AUTO_ALERT_SCORE:
        return []
    if _auto_sent(conn, result["student_id"], "high"):
        return []

    teacher_id = result["advisor"]
    advice = result["actions"][0] if result["actions"] else "与学业导师沟通学习计划"
    student_body = (
        f"当前风险分 {result['score']:.0f}（高风险）。主要依据：{result['driver']}"
        f"（{result['driver_detail']}）。建议：{advice}。"
        f"如记录有误，请携带证明材料联系学业导师复核。"
    )
    teacher_body = (
        f"风险分 {result['score']:.0f}，主要依据：{result['driver']}"
        f"（{result['driver_detail']}）。建议安排面谈并制定学习改进计划。"
    )

    created = [("student", result["student_id"], student_body)]
    if teacher_id:
        created.append(("teacher", teacher_id, teacher_body))

    for role, recipient, body in created:
        _insert_note(
            conn,
            student_id=result["student_id"],
            recipient=recipient,
            recipient_role=role,
            kind="auto",
            level="high",
            score=result["score"],
            author="system",
            title=f"学业风险自动预警（{result['score']:.0f} 分）",
            body=body,
        )
    return created


def check_all(conn):
    """后台巡检：对所有学生重算一次，触发需要的自动预警。"""
    fired = 0
    for row in conn.execute("SELECT id FROM users WHERE identity='学生'").fetchall():
        fired += len(alert_if_needed(conn, assess(conn, row["id"])))
    conn.commit()
    return fired


def notify(ctx):
    """教师留言：内容选填，留空时按主导因素与建议自动生成；只发给学生本人。"""
    _require_teacher(ctx.user)
    sid = ctx.need("student_id", "请选择学生", 40)
    allowed = {row["id"] for row in _visible_students(ctx.conn, ctx.user)}
    if sid not in allowed:
        raise APIError("无权向该学生推送预警", 403)

    result = assess(ctx.conn, sid)
    custom = ctx.arg("message")[:600]
    body = custom or (
        f"当前主要问题：{result['driver']}（{result['driver_detail']}）。"
        f"建议：{result['actions'][0] if result['actions'] else '与学业导师沟通学习计划'}。"
    )
    title = "来自学业导师的提醒"
    _insert_note(
        ctx.conn,
        student_id=sid,
        recipient=sid,
        recipient_role="student",
        kind="manual",
        level=result["level"],
        score=result["score"],
        author=ctx.user["id"],
        title=title,
        body=body,
    )
    ctx.conn.commit()
    return {"ok": True, "title": title, "body": body, "generated": not custom}


def notifications(ctx):
    """当前用户收到的通知：学生收到自动预警与教师留言，教师收到自动预警。"""
    rows = ctx.conn.execute(
        "SELECT n.*, s.name student_name, a.name author_name FROM risk_notes n "
        "LEFT JOIN users s ON n.student_id=s.id "
        "LEFT JOIN users a ON n.author=a.id "
        "WHERE n.recipient=? ORDER BY n.id DESC LIMIT 30",
        (ctx.user["id"],),
    ).fetchall()
    items = []
    for row in rows:
        item = dict(row)
        item["author_name"] = "系统" if item["author"] == "system" else (
            item["author_name"] or "系统"
        )
        items.append(item)
    return {"items": items, "unread": sum(1 for i in items if not i["read_at"])}


def mark_read(ctx):
    note_id = ctx.body.get("id")
    row = ctx.conn.execute(
        "SELECT * FROM risk_notes WHERE id=?", (note_id,)
    ).fetchone()
    if not row:
        raise APIError("通知不存在", 404)
    if row["recipient"] != ctx.user["id"]:
        raise APIError("无权操作该通知", 403)
    ctx.conn.execute(
        "UPDATE risk_notes SET read_at=datetime('now','localtime') WHERE id=?", (note_id,)
    )
    ctx.conn.commit()
    return {"ok": True}


def methodology(_ctx):
    """把评分口径原样暴露给前端，学生与导师看到的是同一套规则。"""
    return {
        "factors": [
            {
                "name": f["name"],
                "weight": f["weight"],
                "window": f["window"],
                "rule": f["rule"],
            }
            for f in FACTORS
        ],
        "levels": [
            {"key": "high", "label": "高风险", "range": "≥ 60 分", "response": "学院组织干预、辅导与缓考评估"},
            {"key": "watch", "label": "关注", "range": "35 – 59 分", "response": "导师面谈并制定学习改进计划"},
            {"key": "low", "label": "正常", "range": "< 35 分", "response": "无需干预，保留记录"},
        ],
        "coverage_rule": f"有效因子权重之和低于 {int(LOW_COVERAGE * 100)}% 时不给等级，避免用残缺数据下结论",
        "auto_alert": {
            "threshold": AUTO_ALERT_SCORE,
            "cooldown_hours": ALERT_COOLDOWN_HOURS,
            "rule": (
                f"风险分达到 {AUTO_ALERT_SCORE:.0f} 分时，系统自动向学生本人与其学业导师"
                f"各发送一条通知；同一学生同一等级在 {ALERT_COOLDOWN_HOURS} 小时内不重复发送。"
            ),
        },
        "policy_ref": "《学业进度与学业预警管理办法》第 2、3 条",
        "limits": [
            "规则引擎不能识别病历、竞赛集训等记录异常，需导师复核后调整",
            "分数反映的是行为记录的模式，不是对学生能力的判断",
            "所有依据均可在学生端逐项查看，符合办法第 4 条的可解释要求",
        ],
    }


def routes():
    return [
        ("GET", "/api/risk/overview", listing),
        ("GET", "/api/risk/me", me),
        ("GET", "/api/risk/student/<student_id>", detail),
        ("POST", "/api/risk/scan", scan),
        ("POST", "/api/risk/notify", notify),
        ("GET", "/api/risk/methodology", methodology),
        ("GET", "/api/notifications", notifications),
        ("POST", "/api/notifications/read", mark_read),
    ]
