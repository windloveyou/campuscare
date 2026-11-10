"""会话与权限。结构对齐主系统 campuscare/server.py 的 auth()，便于合并。"""

import hmac
import secrets
from datetime import datetime, timedelta

from . import db

SESSION_HOURS = 12
COOKIE = "learning_session"


def authenticate(conn, login_id, password):
    """校验账号密码，成功返回 (token, csrf)，失败返回 None。"""
    login_id = (login_id or "").strip().lower()
    if not login_id or not password:
        return None
    row = conn.execute(
        "SELECT * FROM users WHERE lower(id)=? AND enabled=1", (login_id,)
    ).fetchone()
    if not row:
        return None
    if not hmac.compare_digest(row["password"], db.digest(password, row["salt"])):
        return None
    token, csrf = secrets.token_hex(32), secrets.token_hex(24)
    conn.execute("DELETE FROM sessions WHERE expires<?", (db.now_iso(),))
    conn.execute(
        "INSERT INTO sessions VALUES(?,?,?,?)",
        (
            token,
            row["id"],
            (datetime.now() + timedelta(hours=SESSION_HOURS)).isoformat(
                timespec="seconds"
            ),
            csrf,
        ),
    )
    conn.commit()
    return token, csrf


def user_by_session(conn, token):
    if not token:
        return None
    row = conn.execute(
        "SELECT s.csrf FROM sessions s WHERE s.token=? AND s.expires>?",
        (token, db.now_iso()),
    ).fetchone()
    if not row:
        return None
    user = conn.execute(
        "SELECT id,name,role,identity,student_no,program,advisor FROM users "
        "WHERE id=(SELECT user_id FROM sessions WHERE token=?) AND enabled=1",
        (token,),
    ).fetchone()
    if not user:
        return None
    data = dict(user)
    data["csrf"] = row["csrf"]
    return data


def logout(conn, token):
    conn.execute("DELETE FROM sessions WHERE token=?", (token,))
    conn.commit()


def is_student(user):
    return user["identity"] == "学生"


def is_teacher(user):
    """教师 = 学业导师：只看本人名下学生的风险，不碰后台配置。"""
    return user["identity"] == "教师"


def is_sysadmin(user):
    """系统管理员：账号、知识库语料、系统日志与配置。

    刻意不给它看学生成绩与风险名单——那是教师的职责，两类角色不合并。
    """
    return user["identity"] == "系统管理员"


def require(condition, message, status=403):
    if not condition:
        from .http import APIError

        raise APIError(message, status)
