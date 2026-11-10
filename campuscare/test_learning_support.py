"""Integration tests for proposal Modules 1 and 2."""

import tempfile
import threading
import unittest
import urllib.request
from pathlib import Path
from unittest.mock import patch

import server
from test_system import Client


class LearningSupportTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        db = patch.object(server, "DB", Path(temp.name) / "learning.sqlite3")
        db.start()
        self.addCleanup(db.stop)
        server.seed()
        self.http = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.addCleanup(self.http.server_close)
        thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(self.http.shutdown)
        self.base = "http://127.0.0.1:{0}".format(self.http.server_port)

    def login(self, account):
        client = Client(self.base)
        client.login(account)
        return client

    def test_frontend_is_served_from_separate_directory(self):
        self.assertEqual(server.FRONTEND_ROOT.name, "frontend")
        with urllib.request.urlopen(self.base + "/learning.js") as response:
            self.assertEqual(response.status, 200)
            self.assertIn(b"Intelligent Q&A Assistant", response.read())

    def test_cited_question_and_history(self):
        student = self.login("student")
        self.assertEqual(student.call("/learning/questions")[1]["history"], [])
        self.assertEqual(
            student.call("/learning/questions", {"question": "How do I book a venue?"}, csrf=False)[0],
            403,
        )
        status, answer = student.call(
            "/learning/questions", {"question": "How do I book a venue?"}
        )
        self.assertEqual(status, 201)
        self.assertEqual(answer["mode"], "retrieval")
        self.assertEqual(answer["citations"][0]["document_id"], "venue-booking")
        self.assertIn("[1]", answer["answer"])
        history = student.call("/learning/questions")[1]["history"]
        self.assertEqual(history[0]["id"], answer["id"])

    def test_question_activity_updates_student_risk_report(self):
        student = self.login("student")
        before = student.call("/academic-risk")[1]["report"]
        student.call("/learning/questions", {"question": "How can I report a broken projector?"})
        after = student.call("/academic-risk")[1]["report"]
        self.assertEqual(after["counts"]["questions"], before["counts"]["questions"] + 1)
        self.assertGreater(after["score"], before["score"])
        self.assertIn(after["level"], ("low", "medium", "high"))

    def test_faculty_cohort_and_technician_access(self):
        teacher = self.login("teacher")
        status, report = teacher.call("/academic-risk")
        self.assertEqual(status, 200)
        self.assertEqual(report["scope"], "cohort")
        self.assertEqual(report["students"][0]["id"], "student")
        technician = self.login("tech")
        self.assertEqual(technician.call("/academic-risk")[0], 403)


if __name__ == "__main__":
    unittest.main()
