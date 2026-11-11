"""HTTP integration tests using an isolated temporary SQLite DB."""

import base64
import http.cookiejar
import json
import os
import tempfile
import threading
import unittest
import io
from unittest.mock import patch
import urllib.request
import urllib.error
from pathlib import Path
import server
import forecast


class Client:
    def __init__(self, base):
        self.base = base
        self.csrf = ""
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
        )

    def call(self, path, body=None, csrf=True):
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
                raw = r.read()
                return r.status, (
                    json.loads(raw)
                    if "application/json" in r.headers.get("Content-Type", "")
                    else raw
                )
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def login(self, id):
        assert self.call("/login", {"id": id, "password": "Campus2026!"})[0] == 200
        data = self.call("/bootstrap")[1]
        self.csrf = data["user"]["csrf"]
        return data


class SystemTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        server.DB = Path(cls.temp.name) / "test.sqlite3"
        server.seed()
        cls.http = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.http.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.temp.cleanup()

    def client(self, id):
        c = Client(self.base)
        c.login(id)
        return c

    def create(self, c, asset="A-101-FAN-01"):
        status, r = c.call(
            "/tickets",
            {
                "asset_id": asset,
                "title": "集成测试：风扇运行异响",
                "description": "风扇运行十分钟后反复发出异响，需要现场检查。",
                "priority": "medium",
            },
        )
        self.assertEqual(status, 201, r)
        return r["id"]

    def test_01_login_csrf_and_privacy(self):
        c = Client(self.base)
        self.assertEqual(c.call("/bootstrap")[0], 401)
        self.assertEqual(c.call("/login", {"id": "admin", "password": "wrong"})[0], 401)
        data = c.login("student")
        self.assertTrue(any(a["id"] == "D1-201-LOCK-01" for a in data["assets"]))
        self.assertFalse(any(a["id"] == "D2-201-LOCK-01" for a in data["assets"]))
        self.assertEqual(c.call("/ask", {"question": "待分配"}, csrf=False)[0], 403)
        self.assertEqual(c.call("/ask", {"question": "待分配"})[0], 403)
        self.assertEqual(c.call("/forecast")[0], 403)
        self.assertEqual(
            c.call(
                "/tickets",
                {"asset_id": "D2-201-LOCK-01", "description": "测试", "title": "测试"},
            )[0],
            404,
        )

    def test_02_lifecycle_and_concurrency(self):
        user = self.client("student")
        admin = self.client("admin")
        tech = self.client("tech")
        other = self.client("plumber")
        tid = self.create(user)

        def current(c):
            return c.call("/tickets/" + tid)[1]["ticket"]

        def move(c, action, **kw):
            return c.call(
                "/transition",
                {
                    "id": tid,
                    "version": current(c)["version"],
                    "action": action,
                    "note": "实际检查/验收测试记录",
                    **kw,
                },
            )

        self.assertEqual(other.call("/tickets/" + tid)[0], 404)
        self.assertEqual(move(user, "assign", assignee="tech")[0], 403)
        stale = current(admin)["version"]
        self.assertEqual(move(admin, "assign", assignee="tech")[0], 200)
        self.assertEqual(
            admin.call(
                "/transition",
                {"id": tid, "version": stale, "action": "comment", "note": "旧版本"},
            )[0],
            409,
        )
        self.assertEqual(move(tech, "complete")[0], 409)
        for action in ["start", "wait", "resume", "complete"]:
            self.assertEqual(move(tech, action)[0], 200)
        self.assertEqual(move(user, "accept")[0], 200)
        self.assertEqual(current(user)["status"], "closed")
        self.assertEqual(move(user, "reopen")[0], 200)
        self.assertEqual(current(user)["status"], "assigned")
        self.assertEqual(tech.call("/tickets/" + tid)[0], 200)

    def test_03_analysis_duplicates_and_follow(self):
        c = self.client("student")
        other = self.client("teacher")
        tid = self.create(c, "A-202-FAN-01")
        status, r = other.call(
            "/analyze",
            {
                "asset_id": "A-202-FAN-01",
                "description": "吊扇有很大异响，请检查",
                "images": [],
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(r["mode"], "rules")
        self.assertTrue(any(t["id"] == tid for t in r["duplicates"]))
        self.assertEqual(other.call("/tickets/" + tid)[0], 404)
        self.assertEqual(
            other.call("/follow", {"asset_id": "A-202-FAN-01", "ticket_id": tid})[0],
            200,
        )
        self.assertEqual(other.call("/tickets/" + tid)[0], 200)

    def test_04_attachment_access_and_validation(self):
        c = self.client("student")
        other = self.client("teacher")
        image = {
            "mime": "image/png",
            "data": base64.b64encode(b"\x89PNG\r\n\x1a\nTEST").decode(),
        }
        status, r = c.call(
            "/tickets",
            {
                "asset_id": "D1-201-LOCK-01",
                "title": "门锁照片",
                "description": "门锁无法打开",
                "images": [image],
            },
        )
        self.assertEqual(status, 201)
        att = c.call("/tickets/" + r["id"])[1]["attachments"][0]["id"]
        self.assertEqual(c.call("/attachments/" + att)[0], 200)
        self.assertEqual(other.call("/attachments/" + att)[0], 403)
        self.assertEqual(
            c.call(
                "/analyze",
                {
                    "asset_id": "A-101-FAN-01",
                    "description": "测试",
                    "images": [{"mime": "image/svg+xml", "data": "abc"}],
                },
            )[0],
            400,
        )

    def test_05_inspection_and_aggregate(self):
        c = self.client("admin")
        aid = "R3-LIGHT-06"
        self.assertEqual(c.call("/inspections", {"asset_id": aid})[0], 201)
        self.assertEqual(c.call("/inspections", {"asset_id": aid})[0], 409)
        data = c.call("/bootstrap")[1]
        ins = next(i for i in data["inspections"] if i["asset_id"] == aid)
        self.assertEqual(
            c.call(
                "/inspections/complete",
                {"id": ins["id"], "note": "已检查，设施外观完好"},
            )[0],
            200,
        )
        self.assertIn(
            "stored work orders", c.call("/ask", {"question": "Which work orders are unassigned?"})[1]["mode"]
        )

    def test_06_qr(self):
        c = self.client("student")
        status, r = c.call("/qr?asset=A-101-FAN-01")
        self.assertEqual(status, 200)
        self.assertIn(b"<svg", r)
        self.assertEqual(c.call("/qr?asset=D2-201-LOCK-01")[0], 404)

    def test_07_forecast_no_future_leak(self):
        self.assertEqual(
            forecast.features([1, 10, 121, 125], 120), forecast.features([1, 10], 120)
        )
        e = forecast.evaluate()
        self.assertTrue(0 <= e["model_auc"] <= 1)
        self.assertEqual(e, forecast.evaluate())
        c = self.client("admin")
        status, r = c.call("/forecast")
        self.assertEqual(status, 200)
        self.assertTrue(any(a["score"] is None for a in r["assets"]))

    def test_08_state_is_not_single_ticket_status(self):
        c = self.client("student")
        admin = self.client("admin")
        aid = "B-202-FAN-01"
        one = self.create(c, aid)
        two = self.create(c, aid)
        c.call(
            "/transition",
            {"id": one, "version": 1, "action": "cancel", "note": "取消其中一条"},
        )
        a = next(a for a in admin.call("/bootstrap")[1]["assets"] if a["id"] == aid)
        self.assertEqual(a["status"], "assigned")
        self.assertEqual(a["open_count"], 1)

    def test_09_logout_invalidates_session(self):
        c = self.client("student")
        self.assertEqual(c.call("/logout", {})[0], 200)
        self.assertEqual(c.call("/bootstrap")[0], 401)

    def test_10_asset_registration_and_retirement(self):
        admin = self.client("admin")
        user = self.client("student")
        payload = {
            "id": "A-201-FAN-TEST",
            "name": "新登记风扇",
            "category": "风扇",
            "location_id": "A",
            "room": "A-201",
            "position": "讲台侧",
        }
        self.assertEqual(user.call("/assets", payload)[0], 403)
        self.assertEqual(admin.call("/assets", payload)[0], 201)
        self.assertEqual(admin.call("/assets", payload)[0], 409)
        a = next(
            a for a in admin.call("/bootstrap")[1]["assets"] if a["id"] == payload["id"]
        )
        self.assertEqual(a["status"], "unknown")
        self.assertEqual(
            admin.call("/assets/update", {"id": payload["id"], "retired": True})[0], 200
        )
        self.assertEqual(
            user.call(
                "/tickets",
                {"asset_id": payload["id"], "title": "测试", "description": "测试"},
            )[0],
            400,
        )


class ModelAdapterTests(unittest.TestCase):
    def response(self, payload):
        return io.BytesIO(json.dumps({'message': {'content': json.dumps(payload)}}).encode())

    def test_malformed_model_output_falls_back(self):
        with patch.dict(os.environ, {'CAMPUSCARE_OLLAMA_URL': 'http://localhost:11434'}):
            for bad in [[], None, {'unrelated': True}]:
                with patch('urllib.request.urlopen', return_value=self.response(bad)):
                    r=server.model_analysis({'id':'A-101-FAN-01','name':'风扇','category':'风扇'},'风扇异响',[])
                    self.assertEqual(r['mode'],'rules')
                    self.assertIn('Text-based assistance was used instead',r['provider_note'])

    def test_no_image_cannot_become_image_evidence(self):
        with patch.dict(os.environ, {'CAMPUSCARE_OLLAMA_URL': 'http://localhost:11434'}):
            payload={'summary':'The fan is noisy','observations':[{'source':'Photo','text':'Unsupported visual claim'},{'source':'User description','text':'Unusual noise'}]}
            with patch('urllib.request.urlopen', return_value=self.response(payload)):
                r=server.model_analysis({'id':'A-101-FAN-01','name':'风扇','category':'风扇'},'风扇异响',[])
                self.assertEqual(r['mode'],'model')
                self.assertFalse(any(x['source']=='Photo' for x in r['observations']))
                self.assertTrue(any(x['source']=='User description' for x in r['observations']))

if __name__ == "__main__":
    unittest.main(verbosity=2)
