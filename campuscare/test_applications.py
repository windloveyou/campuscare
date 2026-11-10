"""Module 6 integration tests: pre-review, workflow, notifications, permissions.

Runs against an isolated temporary SQLite database and its own HTTP port, so the
demo database and the module 3 tests are untouched.
"""

import base64
import http.cookiejar
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from datetime import date, timedelta
from pathlib import Path

import prereview
import server

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)
PHOTO = {"slot": "id_copy", "mime": "image/png", "name": "id.png", "data": base64.b64encode(PNG).decode()}
PROOF = {"slot": "medical_proof", "mime": "image/png", "name": "doctor.png", "data": base64.b64encode(PNG).decode()}


class Client:
    def __init__(self, base):
        self.base = base
        self.csrf = ""
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
        )

    def call(self, path, body=None, csrf=True, raw=False):
        headers = {"Content-Type": "application/json"}
        if csrf:
            headers["X-CSRF-Token"] = self.csrf
        req = urllib.request.Request(
            self.base + "/api" + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers=headers,
        )
        try:
            with self.opener.open(req) as r:
                payload = r.read()
                if raw:
                    return r.status, payload, r.headers
                return r.status, json.loads(payload)
        except urllib.error.HTTPError as e:
            if raw:
                return e.code, e.read(), e.headers
            return e.code, json.loads(e.read())

    def login(self, uid):
        assert self.call("/login", {"id": uid, "password": "Campus2026!"})[0] == 200
        data = self.call("/bootstrap")[1]
        self.csrf = data["user"]["csrf"]
        return data


def deferral_fields(**over):
    fields = {
        "student_no": "GCU-T-1042",
        "applicant_name": "Demo Faculty",
        "course_code": "CSIT883",
        "exam_date": (date.today() + timedelta(days=9)).isoformat(),
        "reason_category": "Medical",
        "reason_text": (
            "I was admitted to hospital with acute appendicitis and was instructed to remain under "
            "observation for five days, followed by two weeks of rest. The medical certificate is attached."
        ),
        "contact": "13800001234",
    }
    fields.update(over)
    return fields


class ApplicationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        server.DB = Path(cls.temp.name) / "test.sqlite3"
        server.seed()
        cls.http = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = "http://127.0.0.1:%d" % cls.http.server_port

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        try:
            cls.temp.cleanup()
        except OSError:
            # Windows can still hold the SQLite handle; the temp directory is disposable.
            pass

    def client(self, uid):
        c = Client(self.base)
        c.login(uid)
        return c

    # ---------------------------------------------------------------- engine

    def test_engine_rules(self):
        profile = {"identity": "Student", "student_no": "DEMO-STUDENT-01", "class_name": "CSIT883 Demo Class"}
        empty = prereview.evaluate("deferral", {}, [], profile)
        self.assertEqual(empty["decision"], "needs_fix")
        self.assertGreaterEqual(empty["counts"]["errors"], 4)
        self.assertEqual(empty["score"], 0)

        ready = prereview.evaluate(
            "deferral",
            deferral_fields(student_no="DEMO-STUDENT-01", applicant_name="Demo Student"),
            [PROOF],
            profile,
        )
        self.assertEqual(ready["decision"], "ready", [c for c in ready["checks"] if not c["ok"]])
        self.assertEqual(ready["counts"]["errors"], 0)
        self.assertGreater(ready["score"], 80)

        # A past exam date and a missing medical proof are blocking, not advisory.
        past = prereview.evaluate(
            "deferral",
            deferral_fields(exam_date=(date.today() - timedelta(days=1)).isoformat()),
            [],
            profile,
        )
        codes = {c["code"] for c in past["checks"] if not c["ok"]}
        self.assertIn("EXAM_NOT_PAST", codes)
        self.assertIn("MATERIAL_MISSING:medical_proof", codes)
        self.assertEqual(past["decision"], "needs_fix")

        # A student without an enrollment number cannot apply at all.
        bare = prereview.evaluate("transcript", {}, [], {"identity": "Student"})
        self.assertIn("PROFILE_STUDENT_NO", {c["code"] for c in bare["checks"] if not c["ok"]})

        # History-aware checks: active duplicate blocks, recent approval warns.
        history = [
            {"id": "APP-OLD-1", "type": "transcript", "status": "needs_fix", "created": "2026-11-01"},
            {"id": "APP-OLD-2", "type": "transcript", "status": "approved", "created": "2026-10-20",
             "decided": (date.today() - timedelta(days=10)).isoformat()},
        ]
        transcript = {
            "student_no": "DEMO-STUDENT-01", "applicant_name": "Demo Student", "purpose": "Employment",
            "language": "Chinese", "copies": "1", "delivery": "Digital Copy to Campus Email",
        }
        result = prereview.evaluate("transcript", transcript, [PHOTO], profile, history)
        failed = {c["code"] for c in result["checks"] if not c["ok"]}
        self.assertIn("DUPLICATE_ACTIVE", failed)
        self.assertIn("RECENT_APPROVED", failed)
        self.assertEqual(result["decision"], "needs_fix")

    # ------------------------------------------------------------- read APIs

    def test_catalog_and_admin_queue(self):
        admin = self.client("admin")
        status, data = admin.call("/applications")
        self.assertEqual(status, 200)
        self.assertEqual(len(data["catalog"]["types"]), 3)
        self.assertGreaterEqual(data["total"], 3)
        self.assertEqual(data["summary"]["waiting_queue"], 1)
        queued = [a for a in data["applications"] if a["status"] == "pre_checked"]
        self.assertTrue(queued and queued[0]["type_name"] == "Proof of Enrollment")
        self.assertIn("applicant_name", queued[0])
        status, detail = admin.call("/applications/APP-DEMO-001")
        self.assertEqual(status, 200)
        self.assertEqual(detail["status"], "needs_fix")
        self.assertIn("checks", detail["report"])
        self.assertEqual(detail["fields"]["purpose"], "Study Abroad")

    def test_student_sees_only_own_applications(self):
        student = self.client("student")
        status, data = student.call("/applications")
        self.assertEqual(status, 200)
        self.assertTrue(all(a["applicant"] == "student" for a in data["applications"]))
        self.assertGreaterEqual(data["summary"]["action_needed"], 1)

    def test_cross_user_access_denied(self):
        teacher = self.client("teacher")
        self.assertEqual(teacher.call("/applications/APP-DEMO-001")[0], 403)
        with server.connect() as conn:
            material_id = conn.execute(
                "SELECT id FROM application_materials WHERE application_id='APP-DEMO-002'"
            ).fetchone()[0]
        self.assertEqual(teacher.call("/applications/materials/" + material_id, raw=True)[0], 403)
        student = self.client("student")
        status, blob, head = student.call("/applications/materials/" + material_id, raw=True)
        self.assertEqual(status, 200)
        self.assertEqual(head["Content-Type"], "image/png")
        self.assertTrue(blob.startswith(b"\x89PNG"))

    def test_technician_denied(self):
        tech = self.client("tech")
        self.assertEqual(tech.call("/applications")[0], 403)
        self.assertEqual(tech.call("/applications/check", {"type": "transcript"})[0], 403)

    # ----------------------------------------------------------- write flow

    def test_duplicate_active_blocks_submit(self):
        student = self.client("student")
        body = {
            "type": "transcript",
            "fields": {
                "student_no": "DEMO-STUDENT-01", "applicant_name": "Demo Student", "purpose": "Employment",
                "language": "Chinese", "copies": "1", "delivery": "Digital Copy to Campus Email",
            },
            "materials": [PHOTO],
        }
        status, data = student.call("/applications", body)
        self.assertEqual(status, 201)
        self.assertEqual(data["status"], "needs_fix")
        failed = [c for c in data["report"]["checks"] if not c["ok"]]
        self.assertIn("DUPLICATE_ACTIVE", {c["code"] for c in failed})
        # A blocked submission is documented, and no staff notification is created.
        detail = student.call("/applications/" + data["id"])[1]
        self.assertEqual(detail["events"][0]["action"], "submitted")
        # Clean up so the later resubmit test starts from a known history.
        self.assertEqual(student.call("/applications/%s/withdraw" % data["id"], {})[0], 200)

    def test_precheck_does_not_store_anything(self):
        teacher = self.client("teacher")
        before = teacher.call("/applications")[1]["total"]
        status, preview = teacher.call(
            "/applications/check", {"type": "deferral", "fields": {"course_code": "CSIT883"}, "materials": []}
        )
        self.assertEqual(status, 200)
        self.assertEqual(preview["decision"], "needs_fix")
        self.assertTrue(preview["checks"])
        self.assertEqual(teacher.call("/applications")[1]["total"], before)

    def test_teacher_full_flow_approve(self):
        teacher = self.client("teacher")
        status, data = teacher.call(
            "/applications",
            {"type": "deferral", "fields": deferral_fields(), "materials": [PROOF]},
        )
        self.assertEqual(status, 201, data)
        self.assertEqual(data["status"], "pre_checked", data["report"]["checks"])
        aid = data["id"]

        # The applicant is told the result, and every administrator gets a queue notice.
        notices = teacher.call("/notices")[1]
        self.assertTrue(any(n["application_id"] == aid for n in notices["notices"]))
        admin = self.client("admin")
        self.assertTrue(
            any(n["application_id"] == aid for n in admin.call("/notices")[1]["notices"])
        )

        version = teacher.call("/applications/" + aid)[1]["version"]
        # A reviewer must supply a reason when rejecting or returning.
        self.assertEqual(
            admin.call("/applications/%s/decision" % aid, {"action": "reject", "note": "", "version": version})[0],
            400,
        )
        status, result = admin.call(
            "/applications/%s/decision" % aid,
            {"action": "approve", "note": "The medical certificate matches the course record; deferral approved.", "version": version},
        )
        self.assertEqual(status, 200, result)
        self.assertEqual(result["status"], "approved")

        detail = teacher.call("/applications/" + aid)[1]
        self.assertEqual(detail["status"], "approved")
        self.assertEqual(detail["reviewer"], "admin")
        self.assertIn("medical certificate", detail["review_note"])
        self.assertTrue(any(e["action"] == "approved" for e in detail["events"]))
        self.assertEqual(len(detail["materials"]), 1)

        # A stale version cannot overwrite a decided application twice.
        self.assertEqual(
            admin.call("/applications/%s/decision" % aid, {"action": "reject", "note": "Second decision", "version": version})[0],
            409,
        )

    def test_revise_keeps_previously_accepted_material(self):
        teacher = self.client("teacher")
        status, first = teacher.call(
            "/applications",
            {
                "type": "enrollment",
                "fields": {"student_no": "GCU-T-1042", "applicant_name": "Demo Faculty"},
                "materials": [PHOTO],
            },
        )
        self.assertEqual(status, 201)
        self.assertEqual(first["status"], "needs_fix")
        aid = first["id"]
        self.assertEqual(len(teacher.call("/applications/" + aid)[1]["materials"]), 1)

        version = teacher.call("/applications/" + aid)[1]["version"]
        status, second = teacher.call(
            "/applications/%s/revise" % aid,
            {
                "version": version,
                "fields": {
                    "student_no": "GCU-T-1042", "applicant_name": "Demo Faculty",
                    "recipient": "GCU Administrative Services", "language": "Chinese",
                    "valid_until": (date.today() + timedelta(days=30)).isoformat(),
                },
                "materials": [],
            },
        )
        self.assertEqual(status, 201, second)
        # The already uploaded ID copy is kept, so the applicant only fills the gap.
        self.assertEqual(second["status"], "pre_checked", second["report"]["checks"])
        self.assertEqual(len(teacher.call("/applications/" + aid)[1]["materials"]), 1)
        self.assertEqual(teacher.call("/applications/%s/withdraw" % aid, {})[0], 200)

    def test_revise_returns_to_queue(self):
        teacher = self.client("teacher")
        status, first = teacher.call(
            "/applications",
            {"type": "enrollment", "fields": {"student_no": "GCU-T-1042", "applicant_name": "Demo Faculty"}, "materials": []},
        )
        self.assertEqual(status, 201)
        self.assertEqual(first["status"], "needs_fix")
        aid = first["id"]
        version = teacher.call("/applications/" + aid)[1]["version"]

        body = {
            "version": version,
            "fields": {
                "student_no": "GCU-T-1042",
                "applicant_name": "Demo Faculty",
                "recipient": "GCU Community Bank",
                "language": "Bilingual",
                "valid_until": (date.today() + timedelta(days=60)).isoformat(),
            },
            "materials": [PHOTO],
        }
        status, second = teacher.call("/applications/%s/revise" % aid, body)
        self.assertEqual(status, 201, second)
        self.assertEqual(second["status"], "pre_checked")
        self.assertEqual(second["report"]["counts"]["errors"], 0)

        # Re-submitting with an outdated version is refused.
        self.assertEqual(teacher.call("/applications/%s/revise" % aid, body)[0], 409)

    def test_withdraw_then_resubmit(self):
        student = self.client("student")
        status, data = student.call("/applications/APP-DEMO-001/withdraw", {"note": "Withdrawing while preparing updated materials."})
        # APP-DEMO-001 is in needs_fix, so withdrawal is allowed.
        self.assertEqual(status, 200, data)
        self.assertEqual(data["status"], "withdrawn")
        detail = student.call("/applications/APP-DEMO-001")[1]
        self.assertEqual(detail["status"], "withdrawn")

        # With the previous application withdrawn the duplicate rule no longer blocks.
        status, again = student.call(
            "/applications",
            {
                "type": "transcript",
                "fields": {
                    "student_no": "DEMO-STUDENT-01", "applicant_name": "Demo Student", "purpose": "Further Study",
                    "language": "Bilingual", "copies": "2", "delivery": "Digital Copy to Campus Email",
                },
                "materials": [PHOTO],
            },
        )
        self.assertEqual(status, 201)
        self.assertEqual(again["status"], "pre_checked", again["report"]["checks"])
        # A decided application cannot be withdrawn.
        self.assertEqual(student.call("/applications/APP-DEMO-003/withdraw", {})[0], 409)

    def test_notices_unread_and_mark_read(self):
        student = self.client("student")
        data = student.call("/notices")[1]
        self.assertGreater(data["unread"], 0)
        self.assertTrue(all(n["email_state"] in ("skipped", "queued", "sent", "failed") for n in data["notices"]))
        status, result = student.call("/notices/read", {})
        self.assertEqual(status, 200)
        self.assertEqual(result["unread"], 0)
        self.assertEqual(student.call("/notices")[1]["unread"], 0)

    def test_validation_rejects_bad_material(self):
        teacher = self.client("teacher")
        body = {
            "type": "enrollment",
            "fields": {"student_no": "GCU-T-1042", "applicant_name": "Demo Faculty", "recipient": "None"},
            "materials": [{"slot": "id_copy", "mime": "image/png", "name": "fake.png", "data": base64.b64encode(b"not a png").decode()}],
        }
        self.assertEqual(teacher.call("/applications", body)[0], 400)
        body["materials"] = [dict(PHOTO, mime="image/gif")]
        self.assertEqual(teacher.call("/applications", body)[0], 400)


if __name__ == "__main__":
    unittest.main()

