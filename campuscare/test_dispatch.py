"""Maintenance dispatch lifecycle, concurrency and notification regressions."""
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import server
from test_system import Client


class DispatchTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        db = patch.object(server, 'DB', Path(temp.name) / 'dispatch.sqlite3')
        db.start()
        self.addCleanup(db.stop)
        server.seed()
        self.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        self.addCleanup(self.http.server_close)
        thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(self.http.shutdown)
        self.base = f'http://127.0.0.1:{self.http.server_port}'
        self.student = self.login('student')
        self.admin = self.login('admin')

    def login(self, uid):
        client = Client(self.base)
        client.login(uid)
        return client

    def create(self, client=None, asset='A-101-FAN-01'):
        code, result = (client or self.student).call('/tickets', {
            'asset_id': asset, 'title': 'Dispatch regression',
            'description': 'The equipment makes a loud noise during use.', 'priority': 'medium',
        })
        self.assertEqual(code, 201, result)
        return result['id']

    def ticket(self, tid):
        return self.student.call('/tickets/' + tid)[1]['ticket']

    def transition(self, client, tid, action, **extra):
        return client.call('/transition', {'id': tid, 'version': self.ticket(tid)['version'],
                                          'action': action, 'note': 'Regression note', **extra})

    def test_assigned_report_can_be_canceled_before_start(self):
        tid = self.create()
        self.assertEqual(self.ticket(tid)['assignee'], 'tech')
        self.assertEqual(self.ticket(tid)['version'], 1)
        self.assertEqual(self.transition(self.login('teacher'), tid, 'cancel')[0], 404)
        self.assertEqual(self.transition(self.student, tid, 'cancel')[0], 200)
        self.assertEqual(self.ticket(tid)['status'], 'cancelled')
        self.assertIsNone(self.ticket(tid)['assignee'])
        self.assertEqual(self.login('tech').call('/tickets/' + tid)[0], 404)

    def test_started_report_cannot_be_canceled_even_after_reassignment(self):
        tid = self.create()
        tech = self.login('tech')
        self.assertEqual(self.transition(tech, tid, 'start')[0], 200)
        self.assertEqual(self.transition(self.student, tid, 'cancel')[0], 409)
        self.assertEqual(self.transition(self.admin, tid, 'assign', assignee='tech')[0], 200)
        self.assertEqual(self.transition(self.student, tid, 'cancel')[0], 409)

    def test_reopen_dispatches_and_clears_old_result(self):
        tid = self.create()
        tech = self.login('tech')
        for action in ('start', 'complete'):
            self.assertEqual(self.transition(tech, tid, action)[0], 200)
        self.assertEqual(self.transition(self.student, tid, 'accept')[0], 200)
        version = self.ticket(tid)['version']
        self.assertEqual(self.transition(self.student, tid, 'reopen')[0], 200)
        row = self.ticket(tid)
        self.assertEqual((row['status'], row['assignee'], row['result'], row['version']),
                         ('assigned', 'tech', '', version + 1))

    def test_missing_specialist_notifies_once_and_creation_retries(self):
        with server.connect() as c:
            c.execute("UPDATE tickets SET status='closed' WHERE status='pending'")
        tid = self.create(asset='A-101-DESK-01')
        self.assertEqual(self.ticket(tid)['status'], 'pending')
        before = self.admin.call('/notices')[1]['unread']
        for _ in range(2):
            self.assertEqual(self.admin.call('/dispatch/retry', {})[1]['assigned'], 0)
        self.assertEqual(self.admin.call('/notices')[1]['unread'], before)
        self.assertEqual(self.student.call('/dispatch/retry', {})[0], 403)
        self.assertEqual(self.admin.call('/dispatch/retry', {}, csrf=False)[0], 403)
        code, result = self.admin.call('/users', {'username':'carpenter', 'name':'Demo Carpenter',
            'role':'technician', 'skill':'Carpentry', 'enabled':1, 'password':'Campus2026!'})
        self.assertEqual(code, 201, result)
        self.assertEqual(self.ticket(tid)['assignee'], 'carpenter')
        self.assertEqual(self.ticket(tid)['version'], 2)

    def test_restored_technician_dispatches_waiting_work(self):
        # IT demo work must be completed before the existing account can be disabled.
        with server.connect() as c:
            c.execute("UPDATE tickets SET status='closed' WHERE assignee='it'")
        user = self.admin.call('/users/it')[1]['user']
        self.assertEqual(self.admin.call('/users/it', {'version':user['version'], 'enabled':0})[0], 200)
        tid = self.create(asset='B-201-PC-01')
        self.assertEqual(self.ticket(tid)['status'], 'pending')
        user = self.admin.call('/users/it')[1]['user']
        self.assertEqual(self.admin.call('/users/it', {'version':user['version'], 'enabled':1})[0], 200)
        self.assertEqual(self.ticket(tid)['assignee'], 'it')

    def test_concurrent_requests_balance_equal_specialists(self):
        self.admin.call('/users', {'username':'electrician', 'name':'Second Electrician',
            'role':'technician', 'skill':'Electrical', 'enabled':1, 'password':'Campus2026!'})
        with server.connect() as c:
            c.execute("UPDATE tickets SET status='closed' WHERE assignee='tech'")
        clients = [self.login('student'), self.login('teacher')]
        barrier = threading.Barrier(2)
        def create(client):
            barrier.wait()
            return self.create(client)
        with ThreadPoolExecutor(2) as pool:
            ids = list(pool.map(create, clients))
        with server.connect() as c:
            assigned = [c.execute('SELECT assignee FROM tickets WHERE id=?', (tid,)).fetchone()[0] for tid in ids]
        self.assertEqual(set(assigned), {'tech', 'electrician'})

    def test_cancel_and_start_race_has_one_winner(self):
        tid = self.create()
        tech = self.login('tech')
        barrier = threading.Barrier(2)
        def act(pair):
            client, action = pair
            barrier.wait()
            return client.call('/transition', {'id':tid, 'version':1, 'action':action, 'note':'Race test'})[0]
        with ThreadPoolExecutor(2) as pool:
            codes = list(pool.map(act, [(tech, 'start'), (self.student, 'cancel')]))
        self.assertEqual(codes.count(200), 1)
        self.assertIn(next(code for code in codes if code != 200), (404, 409))
        with server.connect() as c:
            self.assertEqual(c.execute("SELECT count(*) FROM events WHERE ticket_id=? AND action IN ('start','cancel')", (tid,)).fetchone()[0], 1)
        self.assertIn(self.ticket(tid)['status'], ('in_progress', 'cancelled'))


if __name__ == '__main__':
    unittest.main()
