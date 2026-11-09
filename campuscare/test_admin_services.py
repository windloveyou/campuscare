"""Exercise the administrative portal against a real HTTP server and SQLite."""

import base64
import hashlib
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import demo_accounts
import server
from test_system import Client


ROOT = "/admin-services"
APPLICATIONS = ROOT + "/applications"
PDF = b"%PDF-1.4\n%%EOF\n"


def material(filename="申请材料.pdf", data=PDF):
    return {"filename": filename, "data": base64.b64encode(data).decode()}


class AdminServicesTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        db = patch.object(server, "DB", Path(temp.name) / "test.sqlite3")
        db.start()
        self.addCleanup(db.stop)
        server.seed()
        self.http = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.addCleanup(self.http.server_close)
        thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(self.http.shutdown)
        self.base = f"http://127.0.0.1:{self.http.server_port}"
        self.student = self.login("student")
        self.admin = self.login("admin")

    def login(self, uid):
        client = Client(self.base)
        client.login(uid)
        return client

    def submit(self, **kwargs):
        body = {"document_type": "transcript", "purpose": "用于实习申请", **kwargs}
        code, result = self.student.call(APPLICATIONS, body)
        self.assertEqual(code, 201, result)
        return APPLICATIONS + "/" + result["id"]

    def test_submit_snapshot_download_and_restart(self):
        catalog = self.student.call(ROOT + "/catalog")[1]
        self.assertTrue(catalog["can_apply"])
        self.assertEqual(catalog["profile"]["student_no"], "DEMO-STUDENT-01")
        edits = {
            "name": " 修正后的姓名 ", "student_no": "updated-2026", "class_name": "新班级",
            "department": "新院系", "email": "Applicant@example.com",
        }
        path = self.submit(materials=[material()], profile=edits, applicant_id="admin")
        self.assertEqual(self.student.call(ROOT + "/catalog")[1]["profile"], catalog["profile"])
        review = self.admin.call(path)[1]
        self.assertEqual(review["application"]["applicant_id"], "student")
        self.assertEqual(review["account_profile"], catalog["profile"])
        with server.connect() as c:
            c.execute("UPDATE users SET name='更新后的资料' WHERE id='student'")
        server.seed()
        detail = self.student.call(path)[1]
        self.assertEqual(detail["application"]["profile"], {
            **edits, "name": "修正后的姓名", "student_no": "UPDATED-2026", "email": "applicant@example.com",
        })
        self.assertNotIn("account_profile", detail)
        self.assertEqual(detail["application"]["status"], "pending")
        self.assertEqual([e["action"] for e in detail["events"]], ["submitted"])
        self.assertNotIn("actor_id", detail["events"][0])
        self.assertNotIn("data", detail["materials"][0])
        url = self.base + "/api" + path + "/materials/" + detail["materials"][0]["id"]
        for client in (self.student, self.admin):
            with client.opener.open(url) as response:
                self.assertEqual(response.read(), PDF)
                self.assertEqual(response.headers["Content-Type"], "application/octet-stream")
                self.assertTrue(response.headers["Content-Disposition"].startswith("attachment; filename*=UTF-8''"))
                self.assertIn("no-store", response.headers["Cache-Control"])
        self.assertEqual(self.student.call(ROOT + "/catalog")[1]["profile"]["name"], "更新后的资料")

    def test_return_supplement_and_approval_with_versions(self):
        path = self.submit(document_type="enrollment")
        self.assertEqual(self.student.call(path + "/materials", {"version": 1, "materials": [material()]})[0], 409)
        decide = path + "/decision"
        self.assertEqual(self.admin.call(decide, {"version": 1, "decision": "needs_materials"})[0], 400)
        code, result = self.admin.call(decide, {"version": 1, "decision": "needs_materials", "note": "请补交身份材料"})
        self.assertEqual((code, result["status"], result["version"]), (200, "needs_materials", 2))
        self.assertEqual(self.admin.call(decide, {"version": 2, "decision": "approved"})[0], 409)
        self.assertEqual(self.student.call(path + "/materials", {"version": 2, "materials": []})[0], 400)
        self.assertEqual(self.student.call(path + "/materials", {"version": 2, "materials": [material()], "note": "按要求补交"})[0], 200)
        self.assertEqual(self.admin.call(decide, {"version": 2, "decision": "approved"})[0], 409)
        self.assertEqual(self.admin.call(decide, {"version": 3, "decision": "approved", "note": "已核对"})[0], 200)
        detail = self.student.call(path)[1]
        self.assertEqual(detail["application"]["status"], "approved")
        self.assertEqual([e["action"] for e in detail["events"]], ["submitted", "needs_materials", "supplemented", "approved"])
        self.assertEqual([e["note"] for e in detail["events"]][1:], ["请补交身份材料", "按要求补交", "已核对"])
        self.assertEqual(detail["materials"][0]["event_id"], detail["events"][2]["id"])
        self.assertEqual(self.student.call(path + "/materials", {"version": 4, "materials": [material()]})[0], 409)

    def test_concurrent_review_creates_one_decision_and_rejection_is_final(self):
        path = self.submit()
        second = self.login("admin")
        gate = threading.Barrier(2)

        def decide(client):
            gate.wait(timeout=5)
            return client.call(path + "/decision", {"version": 1, "decision": "rejected", "note": "当前申请用途不符合条件"})[0]

        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(decide, (self.admin, second))), [200, 409])
        detail = self.student.call(path)[1]
        self.assertEqual([e["action"] for e in detail["events"]], ["submitted", "rejected"])
        self.assertEqual(detail["application"]["version"], 2)
        self.assertEqual(self.admin.call(path + "/decision", {"version": 2, "decision": "approved"})[0], 409)

    def test_role_ownership_and_csrf_are_enforced(self):
        path = self.submit(materials=[material()])
        material_path = path + "/materials/" + self.admin.call(path)[1]["materials"][0]["id"]
        second_path = self.submit()
        self.assertEqual(self.student.call(second_path + "/materials/" + material_path.split("/")[-1])[0], 404)
        for uid in ("teacher", "tech"):
            denied = self.login(uid)
            for resource in (ROOT + "/catalog", ROOT + "/summary", APPLICATIONS, path, material_path):
                self.assertEqual(denied.call(resource)[0], 403)
            self.assertEqual(denied.call(APPLICATIONS, {})[0], 403)
        anon = Client(self.base)
        self.assertEqual(anon.call(material_path)[0], 401)
        self.assertEqual(self.student.call(path + "/decision", {"version": 1, "decision": "approved"})[0], 403)
        self.assertEqual(self.admin.call(path + "/decision", {"version": 1, "decision": "approved"}, csrf=False)[0], 403)
        self.assertEqual(self.admin.call(APPLICATIONS, {})[0], 403)
        code, result = self.admin.call("/users", {
            "username": "student_other", "name": "测试学生", "role": "user", "identity": "学生",
            "student_no": "OTHER-100", "class_name": "测试班", "password": "Student2026!",
        })
        self.assertEqual(code, 201, result)
        other = Client(self.base)
        self.assertEqual(other.call("/login", {"id": "student_other", "password": "Student2026!"})[0], 200)
        other.csrf = other.call("/bootstrap")[1]["user"]["csrf"]
        self.assertEqual(other.call(APPLICATIONS)[1]["applications"], [])
        self.assertEqual(other.call(ROOT + "/summary")[1], {
            "counts": {"pending": 0, "needs_materials": 0, "approved": 0, "rejected": 0}, "recent": [],
        })
        self.assertEqual(other.call(APPLICATIONS + "?q=" + path.split("/")[-1])[1]["total"], 0)
        self.assertEqual(other.call(path)[0], 404)
        self.assertEqual(other.call(material_path)[0], 404)
        self.assertEqual(other.call(path + "/materials", {"version": 1, "materials": [material()]})[0], 404)

    def test_invalid_materials_leave_no_partial_records(self):
        valid = {"document_type": "enrollment", "purpose": "申请交换生"}
        invalid = [
            (400, {"document_type": []}),
            (400, {"purpose": "  "}),
            (400, {"purpose": "长" * 301}),
            (400, {"materials": [material()] * 4}),
            (400, {"materials": [material(), material("../非法.pdf")]}),
            (400, {"materials": [material("材料.png")]}),
            (400, {"materials": [{"filename": "材料.pdf", "data": "not-base64"}]}),
            (413, {"materials": [material(data=PDF + b"x" * (2 * 1024 * 1024))]}),
        ]
        for status, override in invalid:
            with self.subTest(fields=list(override)):
                self.assertEqual(self.student.call(APPLICATIONS, {**valid, **override})[0], status)
        self.assertEqual(self.admin.call(APPLICATIONS)[1]["total"], 0)
        with server.connect() as c:
            self.assertEqual(c.execute("SELECT count(*) FROM admin_service_materials").fetchone()[0], 0)

    def test_profile_validation_and_missing_account_fields_can_be_filled(self):
        with server.connect() as c:
            c.execute("UPDATE users SET student_no=NULL WHERE id='student'")
        catalog = self.student.call(ROOT + "/catalog")[1]
        self.assertTrue(catalog["can_apply"])
        self.assertEqual(catalog["profile"]["student_no"], "")
        body = {"document_type": "enrollment", "purpose": "申请交换生"}
        for invalid in (None, {}, {"student_no": "???"}, {"student_no": "TEST-01", "email": "bad"},
                        {"student_no": "TEST-01", "name": " "}, {"student_no": "TEST-01", "role": "admin"}):
            self.assertEqual(self.student.call(APPLICATIONS, {**body, "profile": invalid})[0], 400)
        path = self.submit(profile={"student_no": "NEW-2026", "class_name": ""})
        profile = self.student.call(path)[1]["application"]["profile"]
        self.assertEqual(profile, {**catalog["profile"], "student_no": "NEW-2026", "class_name": ""})
        self.assertEqual(self.student.call(ROOT + "/catalog")[1]["profile"], catalog["profile"])

    def test_status_filter_and_pagination(self):
        paths = [self.submit() for _ in range(21)]
        enrollment = self.submit(document_type="enrollment")
        self.assertEqual(self.admin.call(paths[-1] + "/decision", {"version": 1, "decision": "approved"})[0], 200)
        first = self.student.call(APPLICATIONS + "?page=1")[1]
        second = self.student.call(APPLICATIONS + "?page=2")[1]
        self.assertEqual((first["total"], len(first["applications"]), len(second["applications"])), (22, 20, 2))
        self.assertEqual(second["applications"][-1]["id"], paths[0].split("/")[-1])
        self.assertEqual(self.admin.call(APPLICATIONS + "?status=pending")[1]["total"], 21)
        self.assertEqual(self.student.call(APPLICATIONS + "?status=approved")[1]["total"], 1)
        self.assertEqual(self.student.call(APPLICATIONS + "?status=missing")[0], 400)
        number = enrollment.split("/")[-1]
        code, filtered = self.student.call(APPLICATIONS + "?status=pending&type=enrollment&q=" + number.lower())
        self.assertEqual(code, 200)
        self.assertEqual([item["id"] for item in filtered["applications"]], [number])
        self.assertEqual(self.student.call(APPLICATIONS + "?type=transcript&q=" + number)[1]["total"], 0)
        self.assertEqual(self.student.call(APPLICATIONS + "?q=%25")[0], 400)
        for client in (self.student, self.admin):
            code, dashboard = client.call(ROOT + "/summary")
            self.assertEqual(code, 200)
            self.assertEqual(dashboard["counts"], {"pending": 21, "needs_materials": 0, "approved": 1, "rejected": 0})
            self.assertEqual(len(dashboard["recent"]), 4)
            self.assertEqual(dashboard["recent"][0]["id"], paths[-1].split("/")[-1])
            self.assertEqual(dashboard["recent"][1]["id"], number)

    def test_upgrade_only_renames_matching_demo_accounts(self):
        placeholder = "旧演示称呼"
        with server.connect() as c:
            c.execute("UPDATE users SET name=?,student_no=NULL,class_name=NULL,department=NULL WHERE id='student'", (placeholder,))
            c.execute("UPDATE users SET name='自定义显示名' WHERE id='teacher'")
        fingerprint = hashlib.sha256(placeholder.encode()).hexdigest()
        with patch.dict(demo_accounts.LEGACY_FINGERPRINTS, student=fingerprint):
            server.seed()
            server.seed()
        self.assertEqual(self.student.call(ROOT + "/catalog")[1]["profile"]["student_no"], "DEMO-STUDENT-01")
        self.assertEqual(self.student.call("/bootstrap")[1]["user"]["name"], "演示学生")
        self.assertEqual(self.login("teacher").call("/bootstrap")[1]["user"]["name"], "自定义显示名")


if __name__ == "__main__":
    unittest.main()
