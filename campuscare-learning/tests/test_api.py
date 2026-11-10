"""端到端测试：真实启动 HTTP 服务，验证鉴权、CSRF、角色权限与预警推送闭环。"""

import json
import threading
import unittest
import urllib.error
import urllib.request
from http.cookiejar import CookieJar
from http.server import ThreadingHTTPServer

from tests import support

support.fresh_db()

import app  # noqa: E402
from core import db  # noqa: E402


class Client:
    def __init__(self, base):
        self.base = base
        self.jar = CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar)
        )
        self.csrf = ""

    def _request(self, method, path, body=None, csrf=True):
        headers = {"Content-Type": "application/json"}
        if csrf and self.csrf:
            headers["X-CSRF-Token"] = self.csrf
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(
            self.base + path, data=data, headers=headers, method=method
        )
        try:
            with self.opener.open(request, timeout=20) as response:
                return response.status, json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as error:
            raw = error.read()
            try:
                return error.code, json.loads(raw)
            except ValueError:
                return error.code, {"raw": raw[:200].decode("utf-8", "ignore")}

    def get(self, path):
        return self._request("GET", path)

    def raw_get(self, path):
        """用于下载接口：返回 (状态码, 响应头, 原始字节)。"""
        request = urllib.request.Request(self.base + path, method="GET")
        try:
            with self.opener.open(request, timeout=20) as response:
                return response.status, dict(response.headers), response.read()
        except urllib.error.HTTPError as error:
            return error.code, dict(error.headers), error.read()

    def post(self, path, body=None, csrf=True):
        return self._request("POST", path, body or {}, csrf=csrf)

    def login(self, user_id, password="Campus2026!"):
        status, data = self.post("/api/login", {"id": user_id, "password": password}, csrf=False)
        if status == 200:
            _, boot = self.get("/api/bootstrap")
            self.csrf = boot["user"]["csrf"]
        return status, data


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        app.prepare()
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        cls.base = "http://127.0.0.1:%d" % cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def client(self, user_id):
        client = Client(self.base)
        status, _ = client.login(user_id)
        self.assertEqual(status, 200)
        return client

    # ---------------------------------------------------------- 鉴权
    def test_anonymous_request_rejected(self):
        status, data = Client(self.base).get("/api/bootstrap")
        self.assertEqual(status, 401)
        self.assertIn("登录", data["error"])

    def test_wrong_password_rejected(self):
        status, _ = Client(self.base).login("teacher", "wrong-password")
        self.assertEqual(status, 401)

    def test_login_returns_csrf(self):
        client = Client(self.base)
        client.login("teacher")
        self.assertTrue(client.csrf)

    def test_write_without_csrf_rejected(self):
        client = self.client("teacher")
        status, data = client.post("/api/risk/scan", {}, csrf=False)
        self.assertEqual(status, 403)

    def test_unknown_api_404(self):
        client = self.client("teacher")
        status, _ = client.get("/api/nope")
        self.assertEqual(status, 404)

    # ---------------------------------------------------------- M1
    def test_ask_returns_citation(self):
        client = self.client("s2023001")
        status, data = client.post("/api/qa/ask", {"question": "作业晚交几天会扣多少分？"})
        self.assertEqual(status, 200)
        self.assertTrue(data["answered"])
        self.assertTrue(data["citations"])
        self.assertGreater(data["log_id"], 0)
        self.assertEqual(data["citations"][0]["doc_title"], "考核与成绩评定办法")

    def test_ask_refuses_off_topic(self):
        client = self.client("s2023001")
        _, data = client.post("/api/qa/ask", {"question": "食堂今天中午有什么菜"})
        self.assertFalse(data["answered"])
        self.assertEqual(data["mode"], "guardrail")

    def test_short_question_rejected(self):
        client = self.client("s2023001")
        status, _ = client.post("/api/qa/ask", {"question": "啊"})
        self.assertEqual(status, 400)

    def test_feedback_recorded(self):
        client = self.client("s2023002")
        _, ask = client.post("/api/qa/ask", {"question": "怎么申请休学"})
        status, data = client.post(
            "/api/qa/feedback", {"log_id": ask["log_id"], "helpful": True}
        )
        self.assertEqual(status, 200)
        self.assertTrue(data["ok"])

    def test_student_cannot_read_knowledge_base(self):
        client = self.client("s2023001")
        status, _ = client.get("/api/qa/knowledge")
        self.assertEqual(status, 403)

    def test_teacher_cannot_read_knowledge_base(self):
        """知识库维护是系统管理员的职责，教师不参与。"""
        client = self.client("teacher")
        status, _ = client.get("/api/qa/knowledge")
        self.assertEqual(status, 403)

    def test_sysadmin_reads_knowledge_and_gaps(self):
        client = self.client("sysadmin")
        status, data = client.get("/api/qa/knowledge")
        self.assertEqual(status, 200)
        self.assertGreaterEqual(len(data["docs"]), 6)
        status, gaps = client.get("/api/qa/gaps")
        self.assertEqual(status, 200)
        self.assertIn("answer_rate", gaps)

    def test_sysadmin_can_upload_corpus_and_rebuild(self):
        client = self.client("sysadmin")
        _, before = client.get("/api/qa/knowledge")
        content = (
            "---\ndoc: TEST-01\ntitle: 测试文件\nowner: 系统管理员\n"
            "version: 1.0\nupdated: 2026-11-09\n---\n\n## 1. 测试章节\n\n"
            + "这是一段用于验证语料上传链路的测试文本，需要足够长以便通过校验。" * 4
        )
        try:
            status, data = client.post(
                "/api/qa/corpus", {"filename": "test_upload.md", "content": content}
            )
            self.assertEqual(status, 200)
            self.assertTrue(data["ok"])
            self.assertFalse(data["replaced"])

            _, after = client.get("/api/qa/knowledge")
            self.assertEqual(len(after["docs"]), len(before["docs"]) + 1)
            uploaded = [d for d in after["docs"] if d["doc_id"] == "TEST-01"]
            self.assertTrue(uploaded, "上传的文档没有进入索引")
            self.assertEqual(uploaded[0]["title"], "测试文件")
            self.assertGreater(after["chunks"], before["chunks"])

            # 覆盖同名文件应当被识别为替换，而不是新增
            status, replaced = client.post(
                "/api/qa/corpus",
                {"filename": "test_upload.md", "content": content + "\n## 2. 补充章节\n\n补充一段内容用于验证覆盖。"},
            )
            self.assertEqual(status, 200)
            self.assertTrue(replaced["replaced"])
        finally:
            target = support.CORPUS / "test_upload.md"
            if target.exists():
                target.unlink()
            client.post("/api/qa/rebuild", {})

        status, data = client.post("/api/qa/rebuild", {})
        self.assertEqual(status, 200)
        self.assertTrue(data["ok"])

    def test_upload_rejects_bad_filename_and_short_content(self):
        client = self.client("sysadmin")
        status, _ = client.post("/api/qa/corpus", {"filename": "../evil.md", "content": "x" * 200})
        self.assertEqual(status, 400)
        status, _ = client.post("/api/qa/corpus", {"filename": "ok.md", "content": "太短"})
        self.assertEqual(status, 400)

    def test_teacher_cannot_upload_corpus(self):
        client = self.client("teacher")
        status, _ = client.post(
            "/api/qa/corpus", {"filename": "hack.md", "content": "## 章节\n" + "内容" * 80}
        )
        self.assertEqual(status, 403)

    def test_sysadmin_reads_accounts_and_logs(self):
        client = self.client("sysadmin")
        status, users = client.get("/api/admin/users")
        self.assertEqual(status, 200)
        self.assertGreaterEqual(users["total"], 15)
        identities = {u["identity"] for u in users["items"]}
        self.assertTrue({"学生", "教师", "系统管理员"} <= identities)

        status, logs = client.get("/api/admin/logs")
        self.assertEqual(status, 200)
        self.assertIn("qa", logs)
        self.assertIn("notes", logs)

    def test_teacher_cannot_read_accounts_or_logs(self):
        client = self.client("teacher")
        self.assertEqual(client.get("/api/admin/users")[0], 403)
        self.assertEqual(client.get("/api/admin/logs")[0], 403)

    # ---------------------------------------------------------- M2
    def test_student_cannot_list_all_students(self):
        client = self.client("s2023001")
        status, _ = client.get("/api/risk/overview")
        self.assertEqual(status, 403)

    def test_student_reads_own_profile(self):
        client = self.client("s2023001")
        status, data = client.get("/api/risk/me")
        self.assertEqual(status, 200)
        self.assertEqual(data["student_id"], "s2023001")
        self.assertEqual(len(data["factors"]), 4)
        self.assertIn("activity", data)

    def test_teacher_overview_only_advisees(self):
        client = self.client("teacher")
        status, data = client.get("/api/risk/overview")
        self.assertEqual(status, 200)
        ids = {item["student_id"] for item in data["items"]}
        self.assertEqual(len(ids), 8)
        self.assertNotIn("s2023009", ids)
        self.assertEqual(sum(data["counts"].values()), 8)

    def test_sysadmin_cannot_read_risk_overview(self):
        """教师与系统管理员是两类用户，后台角色看不到学生预警。"""
        client = self.client("sysadmin")
        status, _ = client.get("/api/risk/overview")
        self.assertEqual(status, 403)

    def test_cross_teacher_detail_forbidden(self):
        client = self.client("teacher")
        status, data = client.get("/api/risk/student/s2023009")
        self.assertEqual(status, 403)
        self.assertIn("无权", data["error"])

    def test_scan_triggers_automatic_alerts(self):
        """高分学生会在学生端与教师端同时出现自动预警。"""
        teacher = self.client("teacher")
        status, scan = teacher.post("/api/risk/scan", {})
        self.assertEqual(status, 200)
        self.assertGreaterEqual(scan["scanned"], 8)

        student = self.client("s2023005")
        _, me = student.get("/api/risk/me")
        auto = [n for n in me["notes"] if n["kind"] == "auto"]
        self.assertTrue(auto, "高风险学生没有收到自动预警")
        self.assertEqual(auto[0]["author"], "system")

        _, inbox = teacher.get("/api/notifications")
        teacher_auto = [
            n for n in inbox["items"]
            if n["kind"] == "auto" and n["student_id"] == "s2023005"
        ]
        self.assertTrue(teacher_auto, "教师没有收到该学生的自动预警")

    def test_auto_alert_is_not_repeated_inside_cooldown(self):
        teacher = self.client("teacher")
        teacher.post("/api/risk/scan", {})
        _, second = teacher.post("/api/risk/scan", {})
        self.assertEqual(second["alerts"], 0)

    def test_manual_message_reaches_student(self):
        teacher = self.client("teacher")
        status, data = teacher.post(
            "/api/risk/notify",
            {"student_id": "s2023005", "message": "周四下午三点来办公室聊一下学习计划。"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(data["body"], "周四下午三点来办公室聊一下学习计划。")

        student = self.client("s2023005")
        _, me = student.get("/api/risk/me")
        manual = [n for n in me["notes"] if n["kind"] == "manual"]
        self.assertTrue(manual)
        self.assertEqual(manual[0]["body"], data["body"])

        status, _ = student.post("/api/notifications/read", {"id": manual[0]["id"]})
        self.assertEqual(status, 200)
        _, again = student.get("/api/risk/me")
        self.assertIsNotNone(
            [n for n in again["notes"] if n["id"] == manual[0]["id"]][0]["read_at"]
        )

    def test_notify_message_is_optional(self):
        """留言选填：留空时按主导因素与建议自动生成正文。"""
        teacher = self.client("teacher")
        status, data = teacher.post("/api/risk/notify", {"student_id": "s2023005"})
        self.assertEqual(status, 200)
        self.assertTrue(data["generated"])
        self.assertIn("建议", data["body"])

    def test_source_returns_document_text(self):
        client = self.client("s2023001")
        _, ask = client.post("/api/qa/ask", {"question": "作业晚交几天会扣多少分？"})
        doc_id = ask["citations"][0]["doc_id"]

        status, doc = client.get("/api/qa/source/" + doc_id)
        self.assertEqual(status, 200)
        self.assertEqual(doc["doc_id"], doc_id)
        self.assertTrue(doc["content"].startswith("---"))
        self.assertIn("##", doc["content"])
        self.assertTrue(doc["filename"].endswith(".md"))

    def test_source_unknown_document(self):
        client = self.client("s2023001")
        status, _ = client.get("/api/qa/source/NOT-A-DOC")
        self.assertEqual(status, 404)

    def test_source_downloads_as_word(self):
        """原文可导出为 Word 附件：返回 docx MIME 与 ZIP 头。"""
        client = self.client("s2023001")
        _, ask = client.post("/api/qa/ask", {"question": "作业晚交几天会扣多少分？"})
        doc_id = ask["citations"][0]["doc_id"]

        status, headers, body = client.raw_get(
            f"/api/qa/source/{doc_id}?format=docx"
        )
        self.assertEqual(status, 200)
        self.assertIn(
            "wordprocessingml.document", headers.get("Content-Type", "")
        )
        self.assertIn(f'filename="{doc_id}.docx"', headers.get("Content-Disposition", ""))
        self.assertTrue(body.startswith(b"PK"))

    def test_answer_offers_followups_and_multiple_sources(self):
        client = self.client("s2023001")
        _, ask = client.post(
            "/api/qa/ask", {"question": "期末挂科了怎么办，会不会被学业预警"}
        )
        self.assertGreaterEqual(len(ask["citations"]), 2)
        self.assertTrue(ask["followups"])
        self.assertLessEqual(len(ask["followups"]), 3)

    def test_student_cannot_read_other_inbox(self):
        """通知按收件人隔离：学生读不到别人的通知。"""
        teacher = self.client("teacher")
        _, inbox = teacher.get("/api/notifications")
        if not inbox["items"]:
            self.skipTest("教师暂时没有通知")
        note_id = inbox["items"][0]["id"]

        student = self.client("s2023001")
        status, _ = student.post("/api/notifications/read", {"id": note_id})
        self.assertEqual(status, 403)

    def test_notify_unknown_student(self):
        client = self.client("teacher")
        status, _ = client.post(
            "/api/risk/notify", {"student_id": "s0000000", "message": "x"}
        )
        self.assertEqual(status, 403)

    def test_methodology_visible_to_student(self):
        client = self.client("s2023001")
        status, data = client.get("/api/risk/methodology")
        self.assertEqual(status, 200)
        self.assertEqual(len(data["factors"]), 4)

    # ---------------------------------------------------------- 静态资源
    def test_static_assets(self):
        opener = urllib.request.build_opener()
        for path, marker in [
            ("/", b"<div id=\"app\">"),
            ("/learning.js", b"function qaPage"),
            ("/learning.css", b"--green"),
        ]:
            with self.subTest(path=path):
                with opener.open(self.base + path, timeout=10) as response:
                    self.assertEqual(response.status, 200)
                    self.assertIn(marker, response.read())

    def test_logout_invalidates_session(self):
        client = self.client("s2023002")
        status, _ = client.post("/api/logout")
        self.assertEqual(status, 200)
        status, _ = client.get("/api/bootstrap")
        self.assertEqual(status, 401)


if __name__ == "__main__":
    unittest.main()
