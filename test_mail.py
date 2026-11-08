"""Mail integration tests with isolated storage and a mocked SMTP transport."""
import json
import os
import re
import smtplib
import ssl
import stat
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import accounts
import mailservice
import server
from test_system import Client


class MailTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.old_db = server.DB
        server.DB = Path(cls.tmp.name) / 'test.sqlite3'
        cls.path = Path(cls.tmp.name) / 'mail-settings.json'
        cls.env = patch.dict(os.environ, {'CAMPUSCARE_MAIL_CONFIG': str(cls.path), 'CAMPUSCARE_MAIL_MODE': 'demo'})
        cls.env.start()
        server.seed()
        cls.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        threading.Thread(target=cls.http.serve_forever, daemon=True).start()
        cls.base = f'http://127.0.0.1:{cls.http.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        server.DB = cls.old_db
        cls.env.stop()
        cls.tmp.cleanup()

    def setUp(self):
        self.path.unlink(missing_ok=True)
        with server.connect() as c:
            c.execute('DELETE FROM auth_limits')
        self.client = Client(self.base)
        self.client.login('admin')
        self.smtp_patch = patch('mailservice.smtplib.SMTP_SSL')
        self.smtp = self.smtp_patch.start()
        self.addCleanup(self.smtp_patch.stop)
        self.connection = self.smtp.return_value.__enter__.return_value
        self.connection.send_message.return_value = {}

    def save(self, provider='qq', sender='sender@qq.com', secret='test-app-password'):
        status, response = self.client.call('/mail/settings', {'provider': provider, 'sender': sender, 'password': secret})
        self.assertEqual(status, 200, response)
        return response

    def test_admin_csrf_and_loopback_required(self):
        anonymous = Client(self.base)
        self.assertEqual(anonymous.call('/mail/settings')[0], 401)
        for user in ['student', 'teacher', 'tech']:
            other = Client(self.base)
            other.login(user)
            self.assertEqual(other.call('/mail/settings')[0], 403)
            self.assertEqual(other.call('/mail/settings', {'mode': 'disabled'})[0], 403)
            self.assertEqual(other.call('/mail/test', {'recipient': 'a@qq.com'})[0], 403)
        self.assertEqual(self.client.call('/mail/settings', {'mode': 'disabled'}, csrf=False)[0], 403)
        self.assertEqual(self.client.call('/mail/test', {'recipient': 'a@qq.com'}, csrf=False)[0], 403)
        fake_handler = object.__new__(server.Handler)
        fake_handler.client_address = ('192.168.1.5', 1234)
        with self.assertRaises(server.APIError):
            fake_handler.mail_admin({'role': 'admin'})
        self.assertFalse(self.path.exists())

    def test_presets_persistence_permissions_no_secret_response(self):
        for provider, host in [('qq', 'smtp.qq.com'), ('163', 'smtp.163.com'), ('gmail', 'smtp.gmail.com')]:
            with self.subTest(provider=provider):
                response = self.save(provider, 'sender@' + ('gmail.com' if provider == 'gmail' else provider + '.com'))
                self.assertEqual(response['host'], host)
                self.assertEqual(response['port'], 465)
                self.assertNotIn('password', response)
                self.assertNotIn('test-app-password', json.dumps(self.client.call('/mail/settings')[1]))
                self.assertEqual(mailservice.config()['password'], 'test-app-password')
                self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), 0o600)
                public = self.client.call('/auth/options')[1]
                self.assertEqual(public['mail_mode'], 'smtp')
                self.assertNotIn('sender@', json.dumps(public))
        self.smtp.assert_not_called()  # Saving does not send mail without a test action.

    def test_password_retention_and_provider_validation(self):
        self.save()
        self.save(secret='')
        self.assertEqual(mailservice.config()['password'], 'test-app-password')
        invalid = [
            {'provider': 'qq', 'sender': 'changed@qq.com', 'password': ''},
            {'provider': '163', 'sender': 'sender@qq.com', 'password': 'abc'},
            {'provider': 'custom', 'sender': 'sender@qq.com', 'password': 'abc'},
            {'provider': [], 'sender': 'sender@qq.com', 'password': 'abc'},
            {'provider': 'qq', 'sender': 'sender@qq.com', 'password': '\u0000invalid'},
            {'provider': 'qq', 'sender': 'sender@qq.com\r\nBcc:bad@example.com', 'password': 'abc'},
        ]
        for value in invalid:
            self.assertEqual(self.client.call('/mail/settings', value)[0], 400)
        self.save('gmail', 'sender@gmail.com', 'abcd efgh ijkl mnop')
        self.assertEqual(mailservice.config()['password'], 'abcdefghijklmnop')

    def test_recipient_domains_get_email_code_without_exposing_it(self):
        self.save()
        for domain in ['gmail.com', 'qq.com', '163.com']:
            email = 'recipient@' + domain
            status, response = self.client.call('/auth/code', {'email': email, 'purpose': 'register'})
            self.assertEqual(status, 200, response)
            self.assertNotIn('demo_code', response)
            message = self.connection.send_message.call_args.args[0]
            self.assertEqual(message['To'], email)
            self.assertEqual(message['From'], 'sender@qq.com')
            code = re.search(r'\b\d{6}\b', message.get_content()).group()
            self.assertNotIn(code, json.dumps(response))
            with server.connect() as c:
                row = c.execute('SELECT * FROM email_codes WHERE id=?', (response['challenge_id'],)).fetchone()
                self.assertEqual(row['code_hash'], server.digest(code, row['salt']))
        self.smtp.assert_called_with('smtp.qq.com', 465, timeout=15, context=unittest.mock.ANY)
        context = self.smtp.call_args.kwargs['context']
        self.assertTrue(context.check_hostname)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.connection.login.assert_called_with('sender@qq.com', 'test-app-password')

    def test_smtp_register_and_reset_end_to_end(self):
        self.save()
        email = 'lifecycle@163.com'
        def get_code(purpose):
            status, result = self.client.call('/auth/code', {'email': email, 'purpose': purpose})
            self.assertEqual(status, 200, result)
            message = self.connection.send_message.call_args.args[0]
            return {'email': email, 'challenge_id': result['challenge_id'], 'code': re.search(r'\b\d{6}\b', message.get_content()).group()}
        register = {**get_code('register'), 'username': 'mail_lifecycle', 'name': '邮件同学', 'student_no': 'MAIL2026', 'class_name': 'CSIT883', 'password': 'MailPassword2026'}
        self.assertEqual(self.client.call('/auth/register', register)[0], 201)
        self.assertEqual(self.client.call('/login', {'id': email, 'password': register['password']})[0], 200)
        reset = {**get_code('reset'), 'password': 'ChangedPassword2026'}
        self.assertEqual(self.client.call('/auth/reset', reset)[0], 200)
        self.assertEqual(self.client.call('/bootstrap')[0], 401)
        self.assertEqual(self.client.call('/login', {'id': email, 'password': reset['password']})[0], 200)

    def test_error_diagnostics_do_not_leak_credentials(self):
        self.save()
        cases = [(smtplib.SMTPAuthenticationError(535, b'test-app-password'), '认证失败'),
                 (smtplib.SMTPRecipientsRefused({'a@qq.com': (550, 'test-app-password')}), '收件邮箱'),
                 (smtplib.SMTPDataError(554, b'test-app-password'), '拒绝发信'),
                 (TimeoutError('test-app-password'), '无法连接'),
                 (ssl.SSLError('test-app-password'), '加密连接')]
        for error, expected in cases:
            self.connection.login.side_effect = error
            status, response = self.client.call('/mail/test', {'recipient': 'a@qq.com'})
            self.assertEqual(status, 503, response)
            self.assertIn(expected, response['error'])
            self.assertNotIn('test-app-password', response['error'])

    def test_test_email_rate_limit_and_accepted_wording(self):
        self.save()
        for _ in range(5):
            status, response = self.client.call('/mail/test', {'recipient': 'a@gmail.com'})
            self.assertEqual(status, 200, response)
            self.assertIn('不代表已送达', response['message'])
        self.assertEqual(self.client.call('/mail/test', {'recipient': 'a@gmail.com'})[0], 429)
        self.assertEqual(self.connection.send_message.call_count, 5)

    def test_failed_send_invalidates_code_and_disable_removes_secret(self):
        self.save()
        self.connection.send_message.side_effect = smtplib.SMTPDataError(554, b'failure')
        status, response = self.client.call('/auth/code', {'email': 'failure@gmail.com', 'purpose': 'register'})
        self.assertEqual(status, 503, response)
        with server.connect() as c:
            self.assertIsNone(c.execute('SELECT 1 FROM email_codes WHERE email=? AND used=0', ('failure@gmail.com',)).fetchone())
        status, response = self.client.call('/mail/settings', {'mode': 'disabled'})
        self.assertEqual(status, 200, response)
        self.assertNotIn('password', self.path.read_text())
        self.assertEqual(accounts.mode(), 'disabled')
        self.assertEqual(self.client.call('/auth/code', {'email': 'new@qq.com', 'purpose': 'register'})[0], 503)

    def test_configuration_switch_invalidates_demo_codes(self):
        status, response = self.client.call('/auth/code', {'email': 'demo@qq.com', 'purpose': 'register'})
        self.assertEqual(status, 200)
        self.assertIn('demo_code', response)
        self.save()
        with server.connect() as c:
            self.assertEqual(c.execute('SELECT used FROM email_codes WHERE id=?', (response['challenge_id'],)).fetchone()[0], 1)

    def test_configuration_change_during_request_cannot_expose_code(self):
        original_rate = accounts.rate
        def rate_and_switch(c, bucket, limit, seconds, Error):
            original_rate(c, bucket, limit, seconds, Error)
            if bucket.startswith('code-email:'):
                mailservice.save({'provider':'qq', 'sender':'sender@qq.com', 'password':'test-app-password'}, accounts.email_address, server.APIError)
        with patch('accounts.rate', side_effect=rate_and_switch):
            status, response = self.client.call('/auth/code', {'email': 'switch@qq.com', 'purpose': 'register'})
        self.assertEqual(status, 200, response)
        self.assertNotIn('demo_code', response)
        self.connection.send_message.assert_called_once()

    def test_corrupt_config_does_not_fall_back_to_demo(self):
        self.path.write_text('{invalid')
        self.assertEqual(accounts.mode(), 'disabled')
        self.assertEqual(mailservice.public_settings()['source'], 'invalid')


if __name__ == '__main__':
    unittest.main(verbosity=2)
