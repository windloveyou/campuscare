"""Private SMTP settings and delivery. Secrets never appear in API responses."""
import json
import os
import smtplib
import ssl
import tempfile
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from pathlib import Path
from threading import RLock

PROVIDERS = {
    'qq': {'name': 'QQ 邮箱', 'host': 'smtp.qq.com', 'domains': ['qq.com', 'foxmail.com']},
    '163': {'name': '163 邮箱', 'host': 'smtp.163.com', 'domains': ['163.com']},
    'gmail': {'name': 'Gmail', 'host': 'smtp.gmail.com', 'domains': ['gmail.com', 'googlemail.com']},
}
LOCK = RLock()


def config_path():
    db = Path(os.environ.get('CAMPUSCARE_DB', str(Path(__file__).parent / 'data/campuscare.sqlite3')))
    return Path(os.environ.get('CAMPUSCARE_MAIL_CONFIG', str(db.parent / 'mail-settings.json')))


def config():
    path = config_path()
    try:
        saved = json.loads(path.read_text())
        if not isinstance(saved, dict) or saved.get('mode') not in ['smtp', 'disabled']:
            return {'mode': 'disabled', 'source': 'invalid'}
        return {**saved, 'source': 'file'}
    except FileNotFoundError:
        return {
            'mode': os.environ.get('CAMPUSCARE_MAIL_MODE', 'disabled'),
            'host': os.environ.get('CAMPUSCARE_SMTP_HOST', ''),
            'port': os.environ.get('CAMPUSCARE_SMTP_PORT', '465' if os.environ.get('CAMPUSCARE_SMTP_TLS', 'ssl') == 'ssl' else '587'),
            'tls': os.environ.get('CAMPUSCARE_SMTP_TLS', 'ssl'),
            'sender': os.environ.get('CAMPUSCARE_SMTP_FROM', ''),
            'username': os.environ.get('CAMPUSCARE_SMTP_USER', ''),
            'password': os.environ.get('CAMPUSCARE_SMTP_PASSWORD', ''),
            'source': 'environment',
        }
    except (OSError, ValueError):
        # A damaged saved configuration must not silently expose demo codes.
        return {'mode': 'disabled', 'source': 'invalid'}


def public_settings():
    current = config()
    return {key: current.get(key, '') for key in ['mode', 'provider', 'sender', 'host', 'port', 'tls', 'source']} | {
        'has_password': bool(current.get('password')),
        'providers': PROVIDERS,
    }


def save(body, email_address, Error):
    with LOCK:
        if body.get('mode', 'smtp') == 'disabled':
            value = {'mode': 'disabled'}  # Disabling removes the saved secret.
        else:
            provider = body.get('provider')
            if not isinstance(provider, str) or provider not in PROVIDERS:
                raise Error('请选择 QQ、163 或 Gmail 发件邮箱')
            sender = email_address(body.get('sender'), Error)
            if sender.rsplit('@', 1)[-1] not in PROVIDERS[provider]['domains']:
                raise Error('发件邮箱与选择的服务商不一致')
            secret = body.get('password', '')
            if not isinstance(secret, str):
                raise Error('请填写邮箱授权码或应用专用密码')
            secret = secret.strip()
            if provider == 'gmail':
                secret = secret.replace(' ', '')
            previous = config()
            if not secret and previous.get('provider') == provider and previous.get('sender') == sender:
                secret = previous.get('password', '')
            if not secret or len(secret) > 256 or any(not 33 <= ord(c) <= 126 for c in secret):
                raise Error('请填写有效的授权码；更换发件邮箱时需重新填写')
            value = {'mode': 'smtp', 'provider': provider, 'sender': sender,
                     'username': sender, 'password': secret,
                     'host': PROVIDERS[provider]['host'], 'port': 465, 'tls': 'ssl'}
        path = config_path()
        temporary = None
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            fd, temporary = tempfile.mkstemp(prefix='.mail-', dir=str(path.parent))
            with os.fdopen(fd, 'w') as stream:
                os.fchmod(stream.fileno(), 0o600)
                json.dump(value, stream)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
        except OSError:
            raise Error('无法保存邮件配置，请检查服务端数据目录权限', 503)
        finally:
            if temporary and os.path.exists(temporary):
                os.unlink(temporary)
        return public_settings()


def send(recipient, subject, text):
    current = config()
    if current.get('mode') != 'smtp' or any(not current.get(k) for k in ['host', 'sender', 'username', 'password']):
        raise ValueError('Missing SMTP configuration')
    tls = current.get('tls', 'ssl')
    if tls not in ['ssl', 'starttls']:
        raise ValueError('Invalid SMTP encryption')
    message = EmailMessage()
    message['Subject'] = subject
    message['From'] = current['sender']
    message['To'] = recipient
    message['Date'] = formatdate(localtime=False)
    message['Message-ID'] = make_msgid(domain=current['sender'].rsplit('@', 1)[-1])
    message.set_content(text)
    context = ssl.create_default_context()
    args = (current['host'], int(current['port']))
    client = smtplib.SMTP_SSL(*args, timeout=15, context=context) if tls == 'ssl' else smtplib.SMTP(*args, timeout=15)
    with client as smtp:
        if tls == 'starttls':
            smtp.ehlo()
            smtp.starttls(context=context)
            smtp.ehlo()
        smtp.login(current['username'], current['password'])
        refused = smtp.send_message(message)
        if refused:
            raise smtplib.SMTPRecipientsRefused(refused)


def test_delivery(recipient, Error):
    try:
        send(recipient, 'CampusCare 邮件服务测试',
             '这是一封由校园管理人员主动发送的测试邮件。\n收到此邮件说明该收件邮箱能够接收本系统邮件。\n注册和找回密码时，请在对应页面点击“获取验证码”。\n此邮件不含验证码，无需回复。')
    except smtplib.SMTPAuthenticationError:
        raise Error('邮箱认证失败：请开启 SMTP 服务，并使用授权码/应用专用密码，不能填写邮箱登录密码。', 503)
    except smtplib.SMTPRecipientsRefused:
        raise Error('收件邮箱被邮件服务拒绝，请检查地址及收件限制。', 503)
    except (smtplib.SMTPSenderRefused, smtplib.SMTPDataError):
        raise Error('邮件服务拒绝发信：请检查发件账号状态、发送额度或邮箱风控提示。', 503)
    except ssl.SSLError:
        raise Error('邮件服务器加密连接失败，请检查系统时间和网络证书。', 503)
    except (OSError, smtplib.SMTPException):
        raise Error('无法连接邮件服务或连接中断，请检查网络和 SMTP 服务；Gmail 需要当前网络能访问 Google。', 503)
    except (ValueError, KeyError):
        raise Error('邮件配置不完整，请先保存发件邮箱和授权码。', 503)
    return {'ok': True, 'message': '邮件服务器已接受测试邮件。请到收件箱或垃圾邮件中确认；服务器接受不代表已送达。'}
