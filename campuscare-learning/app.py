"""CampusCare · Learning Support（Subsystem 1，Module 1 + Module 2）独立运行入口。

单独跑：python app.py          → http://127.0.0.1:8840
合并进主系统：只需在 server.py 里 router.include(learning_qa) 与 include(risk_warning)。
"""

import json
import os
import sys
import threading
import time
from http.cookies import SimpleCookie
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from core import auth, db  # noqa: E402
from core.http import APIError, Ctx, FileResponse, Router, to_json  # noqa: E402
from modules import knowledge, learning_qa, risk_warning  # noqa: E402

CORPUS_DIR = Path(os.environ.get("CAMPUSCARE_LEARNING_CORPUS", str(ROOT / "corpus")))
STATIC = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/learning.js": ("learning.js", "text/javascript; charset=utf-8"),
    "/learning.css": ("learning.css", "text/css; charset=utf-8"),
    "/favicon.ico": ("", "image/x-icon"),
}

router = Router()
router.include(learning_qa)
router.include(risk_warning)


def bootstrap(ctx):
    """首屏一次性拉齐角色能力、模型状态与概览，减少往返。

    五类用户彼此独立：教师只看风险，系统管理员只看后台，两者能力不重叠。
    系统管理员没有知识问答入口，只能进入后台管理。
    """
    user = ctx.user
    identity = user["identity"]
    is_student = identity == "学生"
    is_teacher = identity == "教师"
    is_sysadmin = identity == "系统管理员"
    unread = ctx.conn.execute(
        "SELECT count(*) FROM risk_notes WHERE recipient=? AND read_at IS NULL",
        (user["id"],),
    ).fetchone()[0]
    payload = {
        "user": user,
        "capabilities": {
            "qa": not is_sysadmin,
            "risk_self": is_student,
            "risk_advisor": is_teacher,
            "admin": is_sysadmin,
        },
        "model": learning_qa._model_state(),
        "knowledge": {
            "chunks": knowledge.stats().get("chunks", 0),
            "docs": len(knowledge.stats().get("docs", [])),
            "min_score": learning_qa.MIN_SCORE,
        },
        "alert": {
            "threshold": risk_warning.AUTO_ALERT_SCORE,
            "cooldown_hours": risk_warning.ALERT_COOLDOWN_HOURS,
        },
        "unread": unread,
        "data_source": "synthetic",
    }
    if is_teacher:
        overview = risk_warning.listing(ctx)
        payload["counts"] = overview["counts"]
        payload["advisees"] = len(overview["items"])
    return payload


def admin_users(ctx):
    """后台账号一览（只读）。创建/停用/角色分配由后台管理模块提供。"""
    if ctx.user["identity"] != "系统管理员":
        raise APIError("仅系统管理员可查看", 403)
    rows = ctx.conn.execute(
        "SELECT id,name,identity,student_no,program,advisor,enabled,created "
        "FROM users ORDER BY identity, id"
    ).fetchall()
    return {
        "items": [dict(r) for r in rows],
        "total": len(rows),
        "note": "本页只读：账号创建、激活/停用与角色分配属于后台管理模块，本分支未实现。",
    }


def admin_logs(ctx):
    """系统日志：问答记录与预警推送记录，用于审计与知识库改进。"""
    if ctx.user["identity"] != "系统管理员":
        raise APIError("仅系统管理员可查看", 403)
    qa = ctx.conn.execute(
        "SELECT l.id,l.user_id,u.name user_name,l.question,l.mode,l.answered,"
        "l.confidence,l.latency_ms,l.created FROM qa_logs l "
        "LEFT JOIN users u ON l.user_id=u.id ORDER BY l.id DESC LIMIT 40"
    ).fetchall()
    notes = ctx.conn.execute(
        "SELECT n.id,n.student_id,s.name student_name,n.recipient,n.recipient_role,"
        "n.kind,n.level,n.score,n.title,n.created,n.read_at,a.name author_name "
        "FROM risk_notes n LEFT JOIN users s ON n.student_id=s.id "
        "LEFT JOIN users a ON n.author=a.id ORDER BY n.id DESC LIMIT 20"
    ).fetchall()
    return {"qa": [dict(r) for r in qa], "notes": [dict(r) for r in notes]}


router.add("GET", "/api/bootstrap", bootstrap)
router.add("GET", "/api/admin/users", admin_users)
router.add("GET", "/api/admin/logs", admin_logs)


class Handler(BaseHTTPRequestHandler):
    server_version = "CampusCareLearning/1.0"

    def log_message(self, fmt, *args):
        pass

    # ---------------------------------------------------------- 基础响应
    def send_json(self, payload, status=200, cookie=None, content_type=None):
        raw = payload if isinstance(payload, bytes) else to_json(payload)
        self.send_response(status)
        self.send_header(
            "Content-Type", content_type or "application/json; charset=utf-8"
        )
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(raw)

    def fail(self, error):
        self.send_json({"error": error.message}, error.status)

    def send_file(self, file):
        self.send_response(200)
        self.send_header("Content-Type", file.content_type)
        self.send_header(
            "Content-Disposition", f'attachment; filename="{file.filename}"'
        )
        self.send_header("Content-Length", str(len(file.content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(file.content)

    def read_body(self):
        try:
            size = int(self.headers.get("Content-Length", 0))
        except ValueError:
            raise APIError("请求格式错误")
        if size > 2 * 1024 * 1024:
            raise APIError("请求过大", 413)
        if not size:
            return {}
        try:
            body = json.loads(self.rfile.read(size) or "{}")
        except (ValueError, UnicodeDecodeError):
            raise APIError("JSON 格式错误")
        if not isinstance(body, dict):
            raise APIError("需要 JSON 对象")
        return body

    def token(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except Exception:
            return ""
        item = cookie.get(auth.COOKIE)
        return item.value if item else ""

    # ---------------------------------------------------------- 分发
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if not path.startswith("/api/"):
            return self.serve_static(path)
        with db.connect() as conn:
            try:
                user = auth.user_by_session(conn, self.token())
                if not user:
                    raise APIError("请先登录", 401)
                handler, params = router.match("GET", path)
                if not handler:
                    raise APIError("接口不存在", 404)
                ctx = Ctx(
                    conn,
                    user,
                    query={k: v[0] for k, v in parse_qs(parsed.query).items()},
                    params=params,
                    client=self.client_address[0],
                )
                result = handler(ctx)
                if isinstance(result, FileResponse):
                    self.send_file(result)
                else:
                    self.send_json(result)
            except APIError as error:
                self.fail(error)
            except Exception as error:  # 不把堆栈暴露给前端，只在服务端打印
                print("GET error", type(error).__name__, error)
                self.fail(APIError("服务异常，请重试", 500))

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            body = self.read_body()
        except APIError as error:
            return self.fail(error)

        if path == "/api/login":
            return self.login(body)

        with db.connect() as conn:
            try:
                user = auth.user_by_session(conn, self.token())
                if not user:
                    raise APIError("请先登录", 401)
                import hmac

                if not hmac.compare_digest(
                    self.headers.get("X-CSRF-Token", ""), user["csrf"]
                ):
                    raise APIError("请求校验失败，请刷新页面", 403)
                if path == "/api/logout":
                    auth.logout(conn, self.token())
                    return self.send_json(
                        {"ok": True},
                        cookie=(
                            f"{auth.COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
                        ),
                    )
                handler, params = router.match("POST", path)
                if not handler:
                    raise APIError("接口不存在", 404)
                origin = self.headers.get("Origin")
                if origin and urlparse(origin).netloc != self.headers.get("Host"):
                    raise APIError("不允许跨站请求", 403)
                ctx = Ctx(
                    conn, user, body=body, params=params, client=self.client_address[0]
                )
                result = handler(ctx)
                self.send_json(result[0] if isinstance(result, tuple) else result)
            except APIError as error:
                conn.rollback()
                self.fail(error)
            except Exception as error:
                conn.rollback()
                print("POST error", type(error).__name__, error)
                self.fail(APIError("服务异常，请重试", 500))

    def login(self, body):
        with db.connect() as conn:
            pair = auth.authenticate(
                conn, body.get("id", ""), body.get("password", "")
            )
            if not pair:
                return self.fail(APIError("账号或密码不正确", 401))
            token, _csrf = pair
        self.send_json(
            {"ok": True},
            cookie=(
                f"{auth.COOKIE}={token}; HttpOnly; SameSite=Strict; Path=/; "
                f"Max-Age={auth.SESSION_HOURS * 3600}"
            ),
        )

    def do_DELETE(self):
        # 退出登录用 POST /api/logout 之外，也支持 DELETE /api/session
        if urlparse(self.path).path != "/api/session":
            return self.fail(APIError("接口不存在", 404))
        with db.connect() as conn:
            auth.logout(conn, self.token())
        self.send_json(
            {"ok": True}, cookie=f"{auth.COOKIE}=; Path=/; Max-Age=0; SameSite=Strict"
        )

    def serve_static(self, path):
        entry = STATIC.get(path)
        if not entry or not entry[0]:
            return self.send_json({"error": "页面不存在"}, 404)
        name, content_type = entry
        target = ROOT / "web" / name
        if not target.is_file():
            return self.send_json({"error": "页面不存在"}, 404)
        self.send_json(target.read_bytes(), content_type=content_type)


def prepare():
    db.init()
    knowledge.load(CORPUS_DIR)
    with db.connect() as conn:
        knowledge.sync_db(conn)
        if conn.execute("SELECT count(*) FROM risk_snapshots").fetchone()[0] == 0:
            for sid, *_ in db.STUDENTS:
                risk_warning.save(conn, risk_warning.assess(conn, sid))
            conn.commit()
        # 启动时先巡检一次，让达到阈值的学生与教师立刻收到自动预警
        risk_warning.check_all(conn)


ALERT_INTERVAL = int(os.environ.get("CAMPUSCARE_ALERT_INTERVAL", "3600"))


def alert_worker():
    """后台巡检线程：按固定间隔重算风险分并触发自动预警。

    课程原型用线程实现定时任务；生产环境应换成系统调度（cron / APScheduler）。
    """
    while True:
        time.sleep(ALERT_INTERVAL)
        try:
            with db.connect() as conn:
                fired = risk_warning.check_all(conn)
                if fired:
                    print(f"[alert] auto notifications sent: {fired}", flush=True)
        except Exception as error:  # 巡检失败不能影响主服务
            print("[alert] worker error:", type(error).__name__, error, flush=True)


def main():
    prepare()
    threading.Thread(target=alert_worker, daemon=True).start()
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8840"))
    print(f"CampusCare Learning Support running at http://{host}:{port}", flush=True)
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
