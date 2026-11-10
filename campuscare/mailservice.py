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
    'qq': {'name': 'QQ Mail', 'host': 'smtp.qq.com', 'domains': ['qq.com', 'foxmail.com']},
    '163': {'name': '163 Mail', 'host': 'smtp.163.com', 'domains': ['163.com']},
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
                raise Error('Select a QQ, 163, or Gmail sender account.')
            sender = email_address(body.get('sender'), Error)
            if sender.rsplit('@', 1)[-1] not in PROVIDERS[provider]['domains']:
                raise Error('The sender address does not match the selected provider.')
            secret = body.get('password', '')
            if not isinstance(secret, str):
                raise Error('Enter an authorization code or app password.')
            secret = secret.strip()
            if provider == 'gmail':
                secret = secret.replace(' ', '')
            previous = config()
            if not secret and previous.get('provider') == provider and previous.get('sender') == sender:
                secret = previous.get('password', '')
            if not secret or len(secret) > 256 or any(not 33 <= ord(c) <= 126 for c in secret):
                raise Error('Enter a valid credential. A new sender address requires a new credential.')
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
            raise Error('Could not save email settings. Check access to the server data directory.', 503)
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
        send(recipient, 'SmartCampus Email Delivery Test',
             'A campus administrator sent this test email.\nIf you received it, this inbox can receive SmartCampus email.\nSelect Send Code on the registration or password reset page to request a verification code.\nThis message does not contain a verification code. No reply is needed.')
    except smtplib.SMTPAuthenticationError:
        raise Error('Email authentication failed. Enable SMTP and use an authorization code or app password.', 503)
    except smtplib.SMTPRecipientsRefused:
        raise Error('The provider rejected the recipient address. Check the address and delivery restrictions.', 503)
    except (smtplib.SMTPSenderRefused, smtplib.SMTPDataError):
        raise Error('The provider rejected the message. Check the sender account, sending limits, and provider notices.', 503)
    except ssl.SSLError:
        raise Error('Could not establish an encrypted email connection. Check the system clock and network certificates.', 503)
    except (OSError, smtplib.SMTPException):
        raise Error('The email connection failed. Check the network and SMTP settings. Gmail requires access to Google.', 503)
    except (ValueError, KeyError):
        raise Error('Save the sender address and credential first.', 503)
    return {'ok': True, 'message': 'The server accepted the test message but has not confirmed delivery. Check your inbox and spam folder.'}
