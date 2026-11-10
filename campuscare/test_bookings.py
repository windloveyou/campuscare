"""Module 4 API regression tests against an isolated SQLite database."""

import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlencode

import server
from test_system import Client


START = "2099-03-01T10:00+08:00"
END = "2099-03-01T11:00+08:00"


class BookingTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        db = patch.object(server, "DB", Path(temp.name) / "bookings.sqlite3")
        db.start()
        self.addCleanup(db.stop)
        server.seed()
        self.http = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.addCleanup(self.http.server_close)
        thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(self.http.shutdown)
        self.base = f"http://127.0.0.1:{self.http.server_port}"
        self.student = self.login("student")
        self.admin = self.login("admin")

    def login(self, account):
        client = Client(self.base)
        client.login(account)
        return client

    def request(self, client, **changes):
        body = {"venue_id": "A-101", "start": START, "end": END, "purpose": "课程讨论"}
        return client.call("/bookings", {**body, **changes})

    def venues(self, client, start=START, end=END):
        status, data = client.call("/bookings?" + urlencode({"start": start, "end": end}))
        self.assertEqual(status, 200)
        return {venue["id"]: venue for venue in data["venues"]}

    def mine(self, client):
        return client.call("/bookings")[1]["bookings"]

    def test_approval_is_private_and_notification_survives_cancellation(self):
        teacher = self.login("teacher")
        self.assertEqual({v["category"] for v in self.venues(teacher).values()},
                         {"教室", "实验室", "会议室", "运动场馆"})
        status, booking = self.request(self.student)
        self.assertEqual(status, 201)
        booking_id = booking["id"]
        self.assertEqual(self.venues(teacher)["A-101"]["availability"], "held")
        self.assertEqual(self.mine(teacher), [])
        self.assertEqual(self.admin.call("/bookings")[1]["pending"][0]["id"], booking_id)
        review = {"id": booking_id, "decision": "approved", "note": "已确认"}
        self.assertEqual(self.student.call("/bookings/review", review)[0], 403)
        self.assertEqual(self.admin.call("/bookings/review", review, csrf=False)[0], 403)
        self.assertEqual(self.admin.call("/bookings/review", review)[0], 200)
        self.assertEqual(self.admin.call("/bookings/review", review)[0], 409)
        self.assertEqual(self.request(teacher)[0], 409)
        self.assertEqual(teacher.call("/bookings/read", {"id": booking_id})[0], 404)
        self.assertEqual(teacher.call("/bookings/cancel", {"id": booking_id})[0], 404)
        approved = self.mine(self.student)[0]
        self.assertEqual((approved["decision"], approved["review_note"], approved["read_at"]),
                         ("approved", "已确认", None))
        self.assertEqual(self.student.call("/bookings/read", {"id": booking_id})[0], 200)
        self.assertEqual(self.student.call("/bookings/cancel", {"id": booking_id})[0], 200)
        self.assertEqual(self.student.call("/bookings/cancel", {"id": booking_id})[0], 200)
        server.seed()
        cancelled = self.mine(self.login("student"))[0]
        self.assertEqual((cancelled["status"], cancelled["decision"]), ("cancelled", "approved"))
        self.assertTrue(cancelled["read_at"])
        self.assertEqual(self.venues(teacher)["A-101"]["availability"], "available")

    def test_concurrent_overlap_adjacent_slot_and_rejection(self):
        teacher = self.login("teacher")
        barrier = threading.Barrier(2)

        def reserve(client):
            barrier.wait(timeout=5)
            return client, self.request(client)

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(reserve, [self.student, teacher]))
        self.assertEqual(sorted(status for _, (status, _) in results), [201, 409])
        owner, (_, winner) = next(result for result in results if result[1][0] == 201)
        self.assertEqual(self.request(teacher, start="2099-03-01T03:00Z",
                                      end="2099-03-01T04:00Z")[0], 201)
        review = {"id": winner["id"], "decision": "rejected"}
        self.assertEqual(self.admin.call("/bookings/review", review)[0], 400)
        review["note"] = "请改约其他时间"
        self.assertEqual(self.admin.call("/bookings/review", review)[0], 200)
        rejected = next(b for b in self.mine(owner) if b["id"] == winner["id"])
        self.assertEqual((rejected["decision"], rejected["review_note"]), ("rejected", review["note"]))
        self.assertEqual(self.request(teacher)[0], 201)

    def test_permissions_validation_and_expiry(self):
        self.assertEqual(Client(self.base).call("/bookings")[0], 401)
        tech = self.login("tech")
        self.assertEqual(tech.call("/bookings")[0], 403)
        self.assertEqual(self.request(tech)[0], 403)
        self.assertEqual(self.request(self.admin)[0], 403)
        self.assertEqual(self.request(self.student, start=END)[0], 400)
        self.assertEqual(self.request(self.student, start="2099-03-01T10:00")[0], 400)
        self.assertEqual(self.request(self.student, purpose="   ")[0], 400)
        self.assertEqual(self.request(self.student, venue_id="no-such-venue")[0], 404)
        self.assertEqual(self.student.call("/bookings?start=")[0], 400)
        status, booking = self.request(self.student)
        self.assertEqual(status, 201)
        with patch("bookings.now", return_value="2099-03-01T02:15:00+00:00"):
            self.assertEqual(self.mine(self.student)[0]["status"], "expired")
            self.assertEqual(self.admin.call("/bookings")[1]["pending"], [])
            self.assertEqual(self.admin.call("/bookings/review", {
                "id": booking["id"], "decision": "approved"
            })[0], 409)
            self.assertEqual(self.request(self.student)[0], 400)
            self.assertEqual(self.request(self.student, start="2099-03-01T10:30+08:00")[0], 201)

    def test_upgrade_existing_database_seeds_venues(self):
        with server.connect() as conn:
            ticket_count = conn.execute("SELECT count(*) FROM tickets").fetchone()[0]
            conn.execute("DROP TABLE venue_bookings")
            conn.execute("DROP TABLE venues")
        server.seed()
        self.assertEqual(len(self.venues(self.student)), 5)
        with server.connect() as conn:
            self.assertEqual(conn.execute("SELECT count(*) FROM tickets").fetchone()[0], ticket_count)
