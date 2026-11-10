"""Registration and single-use email recovery codes. No plaintext passwords/codes in DB."""
import hashlib
import hmac
import re
import secrets
from . import mailservice
from . import english_data
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
            'message': 'Local demo: verification codes appear on screen. No emails are sent.' if mail_mode=='demo' else 'Codes are sent by email. Check your spam folder if the message does not arrive.' if mail_mode=='smtp' else 'Email is not configured. Ask an administrator to set up a sender in Email Settings.'}


def rate(c,bucket,limit,seconds,Error):
    cutoff=(now()-timedelta(seconds=seconds)).isoformat(timespec='seconds')
    if c.execute('SELECT count(*) FROM auth_limits WHERE bucket=? AND created>?',(bucket,cutoff)).fetchone()[0]>=limit:
        raise Error('Too many attempts. Try again later.',429)
    c.execute('INSERT INTO auth_limits VALUES(?,?)',(bucket,now().isoformat(timespec='seconds')))
    c.execute('DELETE FROM auth_limits WHERE created<?',((now()-timedelta(days=1)).isoformat(timespec='seconds'),))
    c.commit()


def email_address(value,Error):
    value=str(value or '').strip().lower()
    if len(value)>254 or not re.fullmatch(r'[a-z0-9.!#$%&\x27*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}',value):
        raise Error('Enter a valid email address.')
    return value


def password(value,Error):
    if not isinstance(value,str) or not 10<=len(value)<=128:
        raise Error('Use a password between 10 and 128 characters.')
    if not re.search(r'[A-Za-z]',value) or not re.search(r'[0-9]',value):
        raise Error('The password must contain letters and numbers.')
    return value


def deliver(email,code,purpose):
    mailservice.send(email, 'SmartCampus '+('Registration Verification' if purpose=='register' else 'Password Reset'),
                     f'Your SmartCampus verification code is: {code}\nThe code expires after 10 minutes and can be used once.\nIf you did not request this code, ignore this email.')


def verify(c,body,purpose,hash_password,Error):
    email=email_address(body.get('email'),Error)
    row=c.execute('SELECT * FROM email_codes WHERE id=? AND email=? AND purpose=?',(str(body.get('challenge_id','')),email,purpose)).fetchone()
    if not row or row['used'] or row['attempts']>=5 or row['expires']<=now().isoformat(timespec='seconds'):
        raise Error('The verification code is invalid or expired. Request a new one.')
    code=str(body.get('code',''))
    if not re.fullmatch(r'\d{6}',code) or not hmac.compare_digest(hash_password(code,row['salt']),row['code_hash']):
        c.execute('UPDATE email_codes SET attempts=attempts+1 WHERE id=?',(row['id'],));c.commit()
        raise Error('Incorrect verification code. You have up to five attempts.')
    return email,row['id']


def handle(c,path,body,client,hash_password,Error):
    if path=='/api/auth/code':
        purpose=body.get('purpose')
        if purpose not in ['register','reset']:raise Error('Invalid verification request.')
        email=email_address(body.get('email'),Error)
        mail_mode = mode()
        if mail_mode not in ['demo','smtp']:raise Error('Email is not configured. A verification code cannot be sent.',503)
        if mail_mode=='demo' and client not in ['127.0.0.1','::1']:raise Error('Demo verification codes are available only on this computer.',403)
        c.execute('BEGIN IMMEDIATE')
        rate(c,'code-ip:'+client,20,3600,Error)
        c.execute('BEGIN IMMEDIATE')
        rate(c,'code-email:'+purpose+':'+email,1,60,Error)
        exists=c.execute('SELECT id FROM users WHERE email=? AND email_verified=1 AND enabled=1',(email,)).fetchone()
        code=f'{secrets.randbelow(1000000):06d}';salt=secrets.token_hex(16);cid=secrets.token_hex(24)
        c.execute('BEGIN IMMEDIATE')
        # Settings writes take the same DB lock; re-check after rate-limit commits.
        mail_mode = mode()
        if mail_mode not in ['demo', 'smtp']:raise Error('Email is disabled. Contact an administrator.',503)
        if mail_mode=='demo' and client not in ['127.0.0.1','::1']:raise Error('Demo verification codes are available only on this computer.',403)
        c.execute('UPDATE email_codes SET used=1 WHERE email=? AND purpose=?',(email,purpose))
        c.execute('DELETE FROM email_codes WHERE expires<?',((now()-timedelta(days=1)).isoformat(timespec='seconds'),))
        c.execute('INSERT INTO email_codes(id,email,purpose,salt,code_hash,created,expires,client) VALUES(?,?,?,?,?,?,?,?)',(cid,email,purpose,salt,hash_password(code,salt),now().isoformat(timespec='seconds'),(now()+timedelta(minutes=10)).isoformat(timespec='seconds'),client))
        if mail_mode=='smtp' and (purpose=='register' or exists):
            try:deliver(email,code,purpose)
            except (OSError,ValueError,KeyError):
                c.execute('UPDATE email_codes SET used=1 WHERE id=?',(cid,));c.commit()
                raise Error('The email could not be sent. Try again or contact an administrator.',503)
        result={'challenge_id':cid,'expires_in':600,'resend_after':60,'message':'If this address is eligible, a code will be sent. Check your inbox and spam folder.','mode':mail_mode}
        if mail_mode=='demo':result.update(demo_code=code,message='Local demo verification code. No email was sent.')
        return result
    if path=='/api/auth/register':
        uid=str(body.get('username','')).strip().lower()
        if not re.fullmatch(r'[a-z][a-z0-9_]{3,31}',uid):raise Error('Use 4–32 letters, numbers, or underscores, starting with a letter.')
        name=str(body.get('name','')).strip()
        if not 2<=len(name)<=50:raise Error('The name must be 2–50 characters.')
        identity=english_data.identity(body.get('identity','Student'))
        if identity not in ['Student','Faculty'] or body.get('role','user')!='user':raise Error('Self-registration is available only to students and faculty.',403)
        number=str(body.get('student_no','')).strip().upper()
        if not re.fullmatch(r'[A-Z0-9-]{3,30}',number):raise Error('Enter a 3–30 character student or staff ID using letters, numbers, or hyphens.')
        cls=str(body.get('class_name','')).strip();department=str(body.get('department','')).strip()
        if identity=='Student' and not 1<=len(cls)<=80:raise Error('Students must provide a class name of up to 80 characters.')
        if len(cls)>80 or len(department)>80:raise Error('The class or department exceeds the length limit.')
        secret=password(body.get('password'),Error)
        c.execute('BEGIN IMMEDIATE')
        if c.execute('SELECT 1 FROM users WHERE lower(id)=? OR student_no=?',(uid,number)).fetchone():raise Error('This username or student or staff ID is already registered.',409)
        email,cid=verify(c,body,'register',hash_password,Error)
        if c.execute('SELECT 1 FROM users WHERE email=?',(email,)).fetchone():raise Error('This email is already registered. Sign in or reset your password.',409)
        salt=secrets.token_hex(16)
        c.execute('INSERT INTO users(id,name,role,identity,room,skill,salt,password,email,student_no,class_name,department,email_verified,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,?)',(uid,name,'user',identity,'','',salt,hash_password(secret,salt),email,number,cls,department,now().isoformat(timespec='seconds')))
        c.execute('UPDATE email_codes SET used=1 WHERE id=?',(cid,))
        return {'ok':True,'username':uid,'message':'Registration complete. Sign in to continue. Residence access is verified separately by an administrator.'}
    if path=='/api/auth/reset':
        secret=password(body.get('password'),Error)
        c.execute('BEGIN IMMEDIATE')
        email,cid=verify(c,body,'reset',hash_password,Error)
        user=c.execute('SELECT id FROM users WHERE email=? AND email_verified=1 AND enabled=1',(email,)).fetchone()
        if not user:raise Error('The code or account is invalid. Check your registered email address.')
        salt=secrets.token_hex(16)
        c.execute('UPDATE users SET password=?,salt=? WHERE id=?',(hash_password(secret,salt),salt,user['id']))
        c.execute('UPDATE email_codes SET used=1 WHERE email=?',(email,))
        c.execute('DELETE FROM sessions WHERE user_id=?',(user['id'],))
        return {'ok':True,'message':'Password reset. Existing sessions have ended. Sign in with your new password.'}
    raise Error('Endpoint not found.',404)
