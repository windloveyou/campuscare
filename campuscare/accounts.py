"""Registration and single-use email recovery codes. No plaintext passwords/codes in DB."""
import hashlib
import hmac
import re
import secrets
import mailservice
from datetime import datetime, timedelta, timezone


def now():
    return datetime.now(timezone.utc)


def migrate(c):
    columns = {r['name'] for r in c.execute('PRAGMA table_info(users)')}
    for name, kind in [('email','TEXT'), ('student_no','TEXT'), ('class_name','TEXT'),
                       ('department','TEXT'), ('email_verified','INTEGER DEFAULT 0'), ('created_at','TEXT'),
                       ('enabled','INTEGER NOT NULL DEFAULT 1'), ('version','INTEGER NOT NULL DEFAULT 1'), ('updated_at','TEXT')]:
        if name not in columns:
            c.execute(f'ALTER TABLE users ADD COLUMN {name} {kind}')
    c.executescript('''
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email COLLATE NOCASE) WHERE email IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS users_student_no_unique ON users(student_no COLLATE NOCASE) WHERE student_no IS NOT NULL;
    CREATE TABLE IF NOT EXISTS email_codes(id TEXT PRIMARY KEY,email TEXT,purpose TEXT,salt TEXT,code_hash TEXT,created TEXT,expires TEXT,attempts INTEGER DEFAULT 0,used INTEGER DEFAULT 0,client TEXT);
    CREATE INDEX IF NOT EXISTS email_codes_lookup ON email_codes(email,purpose,created);
    CREATE TABLE IF NOT EXISTS auth_limits(bucket TEXT,created TEXT);
    CREATE INDEX IF NOT EXISTS auth_limits_lookup ON auth_limits(bucket,created);
    CREATE TABLE IF NOT EXISTS user_events(id INTEGER PRIMARY KEY, user_id TEXT REFERENCES users(id), actor TEXT REFERENCES users(id), action TEXT, changes TEXT, note TEXT, created TEXT);
    ''')


def mode():
    return mailservice.config().get('mode', 'disabled')


def options():
    mail_mode = mode()
    return {'mail_mode':mail_mode, 'code_ttl_seconds':600, 'resend_seconds':60,
            'message': '本机演示：验证码显示在页面，不会发送邮件。' if mail_mode=='demo' else '验证码通过邮件发送，支持 Gmail、QQ、163 等邮箱；未收到时请检查垃圾邮件。' if mail_mode=='smtp' else '邮件服务尚未配置，请管理员在“邮件服务”中设置发件邮箱。'}


def rate(c,bucket,limit,seconds,Error):
    cutoff=(now()-timedelta(seconds=seconds)).isoformat(timespec='seconds')
    if c.execute('SELECT count(*) FROM auth_limits WHERE bucket=? AND created>?',(bucket,cutoff)).fetchone()[0]>=limit:
        raise Error('操作过于频繁，请稍后重试',429)
    c.execute('INSERT INTO auth_limits VALUES(?,?)',(bucket,now().isoformat(timespec='seconds')))
    c.execute('DELETE FROM auth_limits WHERE created<?',((now()-timedelta(days=1)).isoformat(timespec='seconds'),))
    c.commit()


def email_address(value,Error):
    value=str(value or '').strip().lower()
    if len(value)>254 or not re.fullmatch(r'[a-z0-9.!#$%&\x27*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}',value):
        raise Error('请输入有效邮箱地址')
    return value


def password(value,Error):
    if not isinstance(value,str) or not 10<=len(value)<=128:
        raise Error('密码需要10–128个字符')
    if not re.search(r'[A-Za-z]',value) or not re.search(r'[0-9]',value):
        raise Error('密码至少包含字母和数字')
    return value


def deliver(email,code,purpose):
    mailservice.send(email, 'CampusCare '+('注册邮箱验证' if purpose=='register' else '重置密码'),
                     f'你的 CampusCare 验证码是：{code}\n有效期10分钟，仅可使用一次。\n如果不是你本人操作，请忽略这封邮件。')


def verify(c,body,purpose,hash_password,Error):
    email=email_address(body.get('email'),Error)
    row=c.execute('SELECT * FROM email_codes WHERE id=? AND email=? AND purpose=?',(str(body.get('challenge_id','')),email,purpose)).fetchone()
    if not row or row['used'] or row['attempts']>=5 or row['expires']<=now().isoformat(timespec='seconds'):
        raise Error('验证码无效或已过期，请重新获取')
    code=str(body.get('code',''))
    if not re.fullmatch(r'\d{6}',code) or not hmac.compare_digest(hash_password(code,row['salt']),row['code_hash']):
        c.execute('UPDATE email_codes SET attempts=attempts+1 WHERE id=?',(row['id'],));c.commit()
        raise Error('验证码不正确；最多尝试5次')
    return email,row['id']


def handle(c,path,body,client,hash_password,Error):
    if path=='/api/auth/code':
        purpose=body.get('purpose')
        if purpose not in ['register','reset']:raise Error('验证码用途无效')
        email=email_address(body.get('email'),Error)
        mail_mode = mode()
        if mail_mode not in ['demo','smtp']:raise Error('邮件服务尚未配置，暂时不能发送验证码',503)
        if mail_mode=='demo' and client not in ['127.0.0.1','::1']:raise Error('演示验证码仅允许本机访问',403)
        c.execute('BEGIN IMMEDIATE')
        rate(c,'code-ip:'+client,20,3600,Error)
        c.execute('BEGIN IMMEDIATE')
        rate(c,'code-email:'+purpose+':'+email,1,60,Error)
        exists=c.execute('SELECT id FROM users WHERE email=? AND email_verified=1 AND enabled=1',(email,)).fetchone()
        code=f'{secrets.randbelow(1000000):06d}';salt=secrets.token_hex(16);cid=secrets.token_hex(24)
        c.execute('BEGIN IMMEDIATE')
        # Settings writes take the same DB lock; re-check after rate-limit commits.
        mail_mode = mode()
        if mail_mode not in ['demo', 'smtp']:raise Error('邮件服务已停用，请联系管理员',503)
        if mail_mode=='demo' and client not in ['127.0.0.1','::1']:raise Error('演示验证码仅允许本机访问',403)
        c.execute('UPDATE email_codes SET used=1 WHERE email=? AND purpose=?',(email,purpose))
        c.execute('DELETE FROM email_codes WHERE expires<?',((now()-timedelta(days=1)).isoformat(timespec='seconds'),))
        c.execute('INSERT INTO email_codes(id,email,purpose,salt,code_hash,created,expires,client) VALUES(?,?,?,?,?,?,?,?)',(cid,email,purpose,salt,hash_password(code,salt),now().isoformat(timespec='seconds'),(now()+timedelta(minutes=10)).isoformat(timespec='seconds'),client))
        if mail_mode=='smtp' and (purpose=='register' or exists):
            try:deliver(email,code,purpose)
            except (OSError,ValueError,KeyError):
                c.execute('UPDATE email_codes SET used=1 WHERE id=?',(cid,));c.commit()
                raise Error('邮件发送失败，请稍后重试或联系管理员',503)
        result={'challenge_id':cid,'expires_in':600,'resend_after':60,'message':'如邮箱可用于本次操作，验证码将发送至该邮箱。请检查收件箱及垃圾邮件。','mode':mail_mode}
        if mail_mode=='demo':result.update(demo_code=code,message='本机测试验证码，仅用于演示，未实际发送邮件。')
        return result
    if path=='/api/auth/register':
        uid=str(body.get('username','')).strip().lower()
        if not re.fullmatch(r'[a-z][a-z0-9_]{3,31}',uid):raise Error('用户名需4–32位，以字母开头，只含字母、数字、下划线')
        name=str(body.get('name','')).strip()
        if not 2<=len(name)<=50:raise Error('姓名需2–50个字符')
        identity=body.get('identity','学生')
        if identity not in ['学生','教师'] or body.get('role','user')!='user':raise Error('自助注册仅支持学生或教师账号',403)
        number=str(body.get('student_no','')).strip().upper()
        if not re.fullmatch(r'[A-Z0-9-]{3,30}',number):raise Error('请填写3–30位学号或工号，仅含字母、数字、连字符')
        cls=str(body.get('class_name','')).strip();department=str(body.get('department','')).strip()
        if identity=='学生' and not 1<=len(cls)<=80:raise Error('学生注册必须填写班级（最多80字符）')
        if len(cls)>80 or len(department)>80:raise Error('班级或院系信息过长')
        secret=password(body.get('password'),Error)
        c.execute('BEGIN IMMEDIATE')
        if c.execute('SELECT 1 FROM users WHERE lower(id)=? OR student_no=?',(uid,number)).fetchone():raise Error('用户名或学号/工号已注册',409)
        email,cid=verify(c,body,'register',hash_password,Error)
        if c.execute('SELECT 1 FROM users WHERE email=?',(email,)).fetchone():raise Error('邮箱已注册，请登录或找回密码',409)
        salt=secrets.token_hex(16)
        c.execute('INSERT INTO users(id,name,role,identity,room,skill,salt,password,email,student_no,class_name,department,email_verified,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,?)',(uid,name,'user',identity,'','',salt,hash_password(secret,salt),email,number,cls,department,now().isoformat(timespec='seconds')))
        c.execute('UPDATE email_codes SET used=1 WHERE id=?',(cid,))
        return {'ok':True,'username':uid,'message':'注册成功，请登录。宿舍权限需由管理人员另行核实分配。'}
    if path=='/api/auth/reset':
        secret=password(body.get('password'),Error)
        c.execute('BEGIN IMMEDIATE')
        email,cid=verify(c,body,'reset',hash_password,Error)
        user=c.execute('SELECT id FROM users WHERE email=? AND email_verified=1 AND enabled=1',(email,)).fetchone()
        if not user:raise Error('验证码或账号无效，请确认注册邮箱')
        salt=secrets.token_hex(16)
        c.execute('UPDATE users SET password=?,salt=? WHERE id=?',(hash_password(secret,salt),salt,user['id']))
        c.execute('UPDATE email_codes SET used=1 WHERE email=?',(email,))
        c.execute('DELETE FROM sessions WHERE user_id=?',(user['id'],))
        return {'ok':True,'message':'密码已重置，旧登录会话已失效，请使用新密码登录。'}
    raise Error('接口不存在',404)
