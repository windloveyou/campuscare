"""Account HTTP tests on temporary data; email delivery is mocked, never sent."""
import os
import secrets
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
import accounts
import server
from test_system import Client


class AccountTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory();cls.old_db=server.DB;server.DB=Path(cls.tmp.name)/'auth.sqlite3'
        server.seed();cls.env=patch.dict(os.environ,{'CAMPUSCARE_MAIL_MODE':'demo','CAMPUSCARE_MAIL_CONFIG':str(Path(cls.tmp.name)/'mail-settings.json')});cls.env.start()
        cls.http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        threading.Thread(target=cls.http.serve_forever,daemon=True).start()
        cls.base=f'http://127.0.0.1:{cls.http.server_port}'
    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown();cls.http.server_close();cls.env.stop();server.DB=cls.old_db;cls.tmp.cleanup()
    def setUp(self):
        self.client=Client(self.base);self.uid='test_'+secrets.token_hex(4);self.email=self.uid+'@example.com'
        with server.connect() as c:c.execute('DELETE FROM auth_limits')
    def code(self,purpose='register',email=None):
        status,r=self.client.call('/auth/code',{'email':email or self.email,'purpose':purpose});self.assertEqual(status,200,r);return r
    def payload(self,r):
        return {'email':self.email,'challenge_id':r['challenge_id'],'code':r['demo_code'],'username':self.uid,'name':'测试同学','student_no':self.uid.upper().replace('_','-'),'class_name':'CSIT883-01','department':'计算机学院','password':'NewPassword2026!','identity':'学生'}
    def register(self):
        p=self.payload(self.code());status,r=self.client.call('/auth/register',p);self.assertEqual(status,201,r);return p
    def test_register_persistence_and_email_login(self):
        p=self.register()
        with server.connect() as c:
            r=c.execute('SELECT * FROM users WHERE id=?',(self.uid,)).fetchone()
            self.assertEqual(r['class_name'],'CSIT883-01');self.assertEqual(r['email_verified'],1);self.assertEqual(r['room'],'')
            self.assertNotEqual(r['password'],p['password']);self.assertTrue(server.digest(p['password'],r['salt'])==r['password'])
            code=c.execute('SELECT * FROM email_codes WHERE id=?',(p['challenge_id'],)).fetchone();self.assertEqual(code['used'],1);self.assertNotEqual(code['code_hash'],p['code'])
        self.assertEqual(self.client.call('/login',{'id':self.email.upper(),'password':p['password']})[0],200)
        data=self.client.call('/bootstrap')[1];self.assertEqual(data['user']['class_name'],'CSIT883-01')
        self.assertFalse(any(a['room']=='D1-201' for a in data['assets']))
    def test_reset_revokes_sessions_and_prevents_reuse(self):
        p=self.register();self.client.call('/login',{'id':self.uid,'password':p['password']})
        r=self.code('reset');body={'email':self.email,'challenge_id':r['challenge_id'],'code':r['demo_code'],'password':'ChangedPass2026!'}
        self.assertEqual(self.client.call('/auth/reset',body)[0],200)
        self.assertEqual(self.client.call('/bootstrap')[0],401)
        self.assertEqual(self.client.call('/login',{'id':self.uid,'password':p['password']})[0],401)
        self.assertEqual(self.client.call('/login',{'id':self.uid,'password':body['password']})[0],200)
        self.assertEqual(self.client.call('/auth/reset',body)[0],400)
    def test_wrong_codes_lock_after_five(self):
        r=self.code();p=self.payload(r);correct=p['code'];p['code']='111111' if correct!='111111' else '222222'
        for _ in range(5):self.assertEqual(self.client.call('/auth/register',p)[0],400)
        p['code']=correct;self.assertEqual(self.client.call('/auth/register',p)[0],400)
        with server.connect() as c:self.assertEqual(c.execute('SELECT attempts FROM email_codes WHERE id=?',(r['challenge_id'],)).fetchone()[0],5)
    def test_expired_and_cross_purpose_codes(self):
        r=self.code();p=self.payload(r)
        self.assertEqual(self.client.call('/auth/reset',p)[0],400)
        with server.connect() as c:c.execute("UPDATE email_codes SET expires='2000-01-01' WHERE id=?",(r['challenge_id'],))
        self.assertEqual(self.client.call('/auth/register',p)[0],400)
    def test_cooldown_and_resend_invalidates_old(self):
        old=self.code();self.assertEqual(self.client.call('/auth/code',{'email':self.email,'purpose':'register'})[0],429)
        with server.connect() as c:c.execute('DELETE FROM auth_limits')
        new=self.code();self.assertEqual(self.client.call('/auth/register',self.payload(old))[0],400)
        self.assertEqual(self.client.call('/auth/register',self.payload(new))[0],201)
    def test_reject_role_escalation_and_missing_class(self):
        p=self.payload(self.code());p['role']='admin';self.assertEqual(self.client.call('/auth/register',p)[0],403)
        p['role']='user';p['class_name']='';self.assertEqual(self.client.call('/auth/register',p)[0],400)
        p['class_name']='班级';p['password']='short';self.assertEqual(self.client.call('/auth/register',p)[0],400)
    def test_unique_account_and_number(self):
        self.register();email2='other_'+self.email;r=self.code(email=email2);p=self.payload(r);p['email']=email2
        self.assertEqual(self.client.call('/auth/register',p)[0],409)
        p['username']='other_'+self.uid;self.assertEqual(self.client.call('/auth/register',p)[0],409)
    def test_smtp_no_debug_code_and_delivery_failure(self):
        with patch.dict(os.environ,{'CAMPUSCARE_MAIL_MODE':'smtp'}),patch('accounts.deliver') as send:
            r=self.code();self.assertNotIn('demo_code',r);send.assert_called_once()
        with server.connect() as c:c.execute('DELETE FROM auth_limits')
        with patch.dict(os.environ,{'CAMPUSCARE_MAIL_MODE':'smtp'}),patch('accounts.deliver',side_effect=OSError('test')):
            self.assertEqual(self.client.call('/auth/code',{'email':self.email,'purpose':'register'})[0],503)
        with server.connect() as c:self.assertFalse(c.execute('SELECT 1 FROM email_codes WHERE email=? AND used=0',(self.email,)).fetchone())
    def test_disabled_and_unknown_reset(self):
        with patch.dict(os.environ,{'CAMPUSCARE_MAIL_MODE':'disabled'}):self.assertEqual(self.client.call('/auth/code',{'email':self.email,'purpose':'reset'})[0],503)
        with patch.dict(os.environ,{'CAMPUSCARE_MAIL_MODE':'smtp'}),patch('accounts.deliver') as send:
            r=self.code('reset');self.assertNotIn('demo_code',r);send.assert_not_called()
    def test_migrate_existing_db_is_idempotent(self):
        c=sqlite3.connect(':memory:');c.row_factory=sqlite3.Row
        c.execute('CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,role TEXT,identity TEXT,room TEXT,skill TEXT,salt TEXT,password TEXT)')
        c.execute("INSERT INTO users VALUES('old','旧用户','user','学生','','','salt','hash')")
        accounts.migrate(c);accounts.migrate(c)
        self.assertEqual(c.execute('SELECT password FROM users WHERE id="old"').fetchone()[0],'hash');c.close()

if __name__=='__main__':unittest.main(verbosity=2)
