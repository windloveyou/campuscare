"""User administration API tests on fresh databases; no external email/network."""
import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
import server
from test_system import Client


class UserAdminTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_db = server.DB
        server.DB = Path(self.temp.name) / 'test.sqlite3'
        self.env = patch.dict(os.environ, {'CAMPUSCARE_MAIL_CONFIG':str(Path(self.temp.name)/'mail.json'), 'CAMPUSCARE_MAIL_MODE':'demo'})
        self.env.start()
        server.seed()
        self.http = server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        threading.Thread(target=self.http.serve_forever,daemon=True).start()
        self.base = f'http://127.0.0.1:{self.http.server_port}'
        self.admin = Client(self.base); self.admin.login('admin')

    def tearDown(self):
        self.http.shutdown(); self.http.server_close()
        server.DB=self.old_db; self.env.stop(); self.temp.cleanup()

    def get(self,uid):
        status,r=self.admin.call('/users/'+uid);self.assertEqual(status,200,r);return r['user']

    def create(self,uid='new_member',**changes):
        body={'username':uid,'name':'测试成员','role':'user','identity':'学生','student_no':'NEW2026','class_name':'CSIT883-01','password':'InitialPassword2026'}
        body.update(changes)
        status,r=self.admin.call('/users',body); self.assertEqual(status,201,r);return r['user']

    def edit(self,uid,**changes):
        return self.admin.call('/users/'+uid,{'version':self.get(uid)['version'],**changes})

    def test_admin_only_private_directory_and_csrf(self):
        for uid in ['student','teacher','tech']:
            client=Client(self.base);bootstrap=client.login(uid)
            self.assertNotIn('users',bootstrap)
            for path in ['/users','/users/student']:
                self.assertEqual(client.call(path)[0],403)
            self.assertEqual(client.call('/users/student',{'version':1,'role':'admin'})[0],403)
            self.assertEqual(client.call('/users/student/password',{'version':1,'password':'Changed2026pass'})[0],403)
            self.assertEqual(client.call('/users',{})[0],403)
        self.assertEqual(Client(self.base).call('/users')[0],401)
        self.assertEqual(self.admin.call('/users/student',{'version':1,'name':'伪造修改'},csrf=False)[0],403)

    def test_create_login_hash_uniqueness_and_secret_free_audit(self):
        user=self.create();client=Client(self.base)
        self.assertEqual(client.call('/login',{'id':user['id'],'password':'InitialPassword2026'})[0],200)
        with server.connect() as c:
            row=c.execute('SELECT * FROM users WHERE id=?',(user['id'],)).fetchone()
            self.assertNotEqual(row['password'],'InitialPassword2026')
        raw=json.dumps(self.admin.call('/users/'+user['id'])[1])
        self.assertNotIn('InitialPassword2026',raw);self.assertNotIn('"password"',raw);self.assertNotIn('"salt"',raw)
        self.assertEqual(self.admin.call('/users',{'username':'another','name':'另一同学','role':'user','identity':'学生','student_no':'NEW2026','class_name':'CSIT883','password':'InitialPassword2026'})[0],409)

    def test_room_permission_changes_and_revokes_session(self):
        student=Client(self.base);student.login('student')
        self.assertEqual(self.edit('student',room='D2-202',class_name='883班',student_no='STUDENT883')[0],200)
        self.assertEqual(student.call('/bootstrap')[0],401)
        boot=student.login('student');self.assertEqual(boot['user']['class_name'],'883班')
        self.assertTrue(any(a['room']=='D2-202' for a in boot['assets']))
        self.assertFalse(any(a['room']=='D1-201' for a in boot['assets']))
        self.assertEqual(self.edit('student',room='D9-999')[0],400)
        self.assertEqual(self.edit('student',email='attacker@qq.com',email_verified=1)[0],400)

    def test_disable_restore_login_and_password_recovery(self):
        user=self.create();client=Client(self.base)
        with server.connect() as c:
            c.execute('UPDATE users SET email=?,email_verified=1 WHERE id=?',('user@qq.com',user['id']))
        client.call('/login',{'id':user['id'],'password':'InitialPassword2026'})
        _,code=client.call('/auth/code',{'email':'user@qq.com','purpose':'reset'})
        self.assertEqual(self.edit(user['id'],enabled=0)[0],200)
        self.assertEqual(client.call('/bootstrap')[0],401)
        self.assertEqual(client.call('/login',{'id':user['id'],'password':'InitialPassword2026'})[0],401)
        self.assertEqual(client.call('/auth/reset',{'email':'user@qq.com','challenge_id':code['challenge_id'],'code':code['demo_code'],'password':'CannotReset2026'})[0],400)
        self.assertEqual(self.edit(user['id'],enabled=1)[0],200)
        self.assertEqual(client.call('/login',{'id':user['id'],'password':'InitialPassword2026'})[0],200)

    def test_work_in_progress_prevents_disable_or_demotion(self):
        self.assertEqual(self.edit('tech',enabled=0)[0],409)
        self.assertEqual(self.edit('it',role='user',identity='教师')[0],409)
        with server.connect() as c:
            c.execute("UPDATE tickets SET status='closed' WHERE assignee='tech'")
        self.assertEqual(self.edit('tech',enabled=0)[0],200)
        self.assertFalse(any(t['id']=='tech' for t in self.admin.call('/bootstrap')[1]['technicians']))
        self.assertEqual(self.admin.call('/transition',{'id':'WO-DEMO-002','action':'assign','assignee':'tech','version':1})[0],400)

    def test_self_protection_and_role_changes(self):
        self.assertEqual(self.edit('admin',enabled=0)[0],409)
        self.assertEqual(self.edit('admin',role='user',identity='教师')[0],409)
        self.create('second_admin',role='admin',student_no='ADMIN2026')
        second=Client(self.base);second.call('/login',{'id':'second_admin','password':'InitialPassword2026'})
        second.csrf=second.call('/bootstrap')[1]['user']['csrf']
        row=self.get('admin')
        self.assertEqual(second.call('/users/admin',{'version':row['version'],'role':'user','identity':'教师'})[0],200)
        self.assertEqual(self.admin.call('/users')[0],401)
        row=second.call('/users/second_admin')[1]['user']
        self.assertEqual(second.call('/users/second_admin',{'version':row['version'],'enabled':0})[0],409)

    def test_password_reset_and_stale_version(self):
        user=self.create();client=Client(self.base)
        client.call('/login',{'id':user['id'],'password':'InitialPassword2026'})
        status,r=self.admin.call('/users/'+user['id']+'/password',{'version':user['version'],'password':'Replacement2026!','note':'已核实本人'})
        self.assertEqual(status,200,r)
        self.assertEqual(client.call('/bootstrap')[0],401)
        self.assertEqual(client.call('/login',{'id':user['id'],'password':'InitialPassword2026'})[0],401)
        self.assertEqual(client.call('/login',{'id':user['id'],'password':'Replacement2026!'})[0],200)
        self.assertEqual(self.admin.call('/users/'+user['id'],{'version':user['version'],'name':'过期修改'})[0],409)
        self.assertNotIn('Replacement2026!',json.dumps(self.admin.call('/users/'+user['id'])[1]))

    def test_query_filters_pagination_and_literal_wildcards(self):
        for i in range(21):
            with server.connect() as c:
                c.execute("INSERT INTO users(id,name,role,identity,enabled) VALUES(?,?,'user','教师',1)",(f'query_{i:02}',f'分页教师{i}'))
        status,r=self.admin.call('/users?q=query_&role=user&enabled=1');self.assertEqual(status,200,r)
        self.assertEqual(r['total'],21);self.assertEqual(len(r['users']),20)
        self.assertEqual(len(self.admin.call('/users?q=query_&page=2')[1]['users']),1)
        self.assertEqual(self.admin.call('/users?q=%25')[1]['total'],0)
        self.assertEqual(self.admin.call('/users?page=bad')[0],400)
        self.assertEqual(self.admin.call('/users?role=invalid')[0],400)

    def test_validation_and_preserved_history(self):
        self.assertEqual(self.admin.call('/users',{'username':'invalid','name':'缺省字段'})[0],400)
        self.assertEqual(self.edit('student',name='A')[0],400)
        self.assertEqual(self.edit('student',enabled='false')[0],400)
        self.assertEqual(self.edit('student',role='technician',skill='')[0],400)
        self.assertEqual(self.edit('student',role='technician',skill='电工')[0],200)
        user=self.get('student');self.assertEqual(user['room'],'');self.assertEqual(user['identity'],'维修人员')
        self.assertEqual(self.edit('teacher',enabled=0,note='离校办理')[0],200)
        with server.connect() as c:
            self.assertTrue(c.execute("SELECT 1 FROM tickets WHERE reporter='teacher'").fetchone())
        audit=self.admin.call('/users/teacher')[1]['events'][0]
        self.assertEqual(audit['note'],'离校办理');self.assertEqual(audit['changes']['enabled']['after'],0)


if __name__=='__main__':unittest.main(verbosity=2)
