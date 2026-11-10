"""Administrator user lifecycle; preserve identities referenced by maintenance records."""
import json
import re
import secrets
import sqlite3
from . import accounts
from . import english_data

FIELDS = 'id,name,role,identity,room,skill,email,email_verified,student_no,class_name,department,enabled,version,created_at,updated_at'
EDITABLE = ('name', 'role', 'identity', 'room', 'skill', 'student_no', 'class_name', 'department', 'enabled')
ROLES = {'user', 'technician', 'admin'}


def require_admin(c, actor, Error):
    current = c.execute('SELECT role,enabled FROM users WHERE id=?', (actor['id'],)).fetchone()
    if not current or current['role'] != 'admin' or not current['enabled']:
        raise Error('Only administrators can manage users.', 403)


def rooms(c):
    return [r[0] for r in c.execute("SELECT DISTINCT a.room FROM assets a JOIN locations l ON l.id=a.location_id WHERE l.kind='dorm' AND a.room!='PUBLIC' ORDER BY a.room")]


def detail(c, uid, Error):
    row = c.execute(f'SELECT {FIELDS} FROM users WHERE id=?', (uid,)).fetchone()
    if not row:
        raise Error('User not found.', 404)
    return dict(row)


def listing(c, actor, query, Error):
    require_admin(c, actor, Error)
    q = str(query.get('q', [''])[0]).strip()[:100]
    role = query.get('role', [''])[0]
    enabled = query.get('enabled', [''])[0]
    try:
        page = max(1, int(query.get('page', ['1'])[0]))
    except (ValueError, TypeError):
        raise Error('Invalid page number.')
    clauses, args = [], []
    if q:
        term = '%' + q.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
        clauses.append("(" + ' OR '.join(f"{key} LIKE ? ESCAPE '\\'" for key in ['id','name','email','student_no','class_name']) + ")")
        args.extend([term] * 5)
    if role:
        if role not in ROLES:
            raise Error('Invalid role filter.')
        clauses.append('role=?'); args.append(role)
    if enabled:
        if enabled not in ['0', '1']:
            raise Error('Invalid status filter.')
        clauses.append('enabled=?'); args.append(int(enabled))
    where = ' WHERE ' + ' AND '.join(clauses) if clauses else ''
    total = c.execute('SELECT count(*) FROM users' + where, args).fetchone()[0]
    page = min(page, max(1, (total + 19) // 20))
    rows = [dict(r) for r in c.execute(f'SELECT {FIELDS} FROM users' + where + ' ORDER BY enabled DESC,role,id LIMIT 20 OFFSET ?', args + [(page-1)*20])]
    summary = dict(c.execute("SELECT count(*) total,sum(enabled=1) enabled,sum(role='admin' AND enabled=1) admins,sum(role='technician' AND enabled=1) technicians FROM users").fetchone())
    return {'users': rows, 'total': total, 'page': page, 'page_size': 20, 'summary': summary, 'rooms': rooms(c)}


def history(c, actor, uid, Error):
    require_admin(c, actor, Error)
    user = detail(c, uid, Error)
    events = []
    for row in c.execute('SELECT e.*,u.name actor_name FROM user_events e JOIN users u ON u.id=e.actor WHERE user_id=? ORDER BY e.id DESC LIMIT 50', (uid,)):
        item = dict(row); item['changes'] = json.loads(item['changes']); events.append(item)
    user['open_tasks'] = c.execute("SELECT count(*) FROM tickets WHERE assignee=? AND status NOT IN ('closed','cancelled')", (uid,)).fetchone()[0]
    return {'user': user, 'events': events, 'rooms': rooms(c)}


def normalized(c, body, old, Error):
    value = {key: body.get(key, old.get(key, '' if key != 'enabled' else 1)) for key in EDITABLE}
    for key in EDITABLE:
        if key != 'enabled':
            if value[key] is None: value[key] = ''
            if not isinstance(value[key], str): raise Error('Invalid account details.')
            value[key] = value[key].strip()
    if value['role'] not in ROLES: raise Error('Select a valid role.')
    if value['enabled'] not in [0, 1] or not isinstance(value['enabled'], (int, bool)): raise Error('Invalid account status.')
    value['enabled'] = int(value['enabled'])
    if not 2 <= len(value['name']) <= 50: raise Error('The name must be 2–50 characters.')
    if value['role'] == 'user':
        value['identity'] = english_data.identity(value['identity'])
        if value['identity'] not in ['Student', 'Faculty']: raise Error('Select Student or Faculty for a campus member.')
    else:
        value['identity'] = 'Technician' if value['role'] == 'technician' else 'Administrator'
    value['student_no'] = value['student_no'].upper() or None
    if value['student_no'] and not re.fullmatch(r'[A-Z0-9-]{3,30}', value['student_no']): raise Error('The student or staff ID must contain 3–30 letters, numbers, or hyphens.')
    for key in ['class_name', 'department', 'skill']:
        if len(value[key]) > 80: raise Error('Class, department, and specialty can contain up to 80 characters each.')
    # Preserve existing demo accounts without forcing invented enrollment details.
    if value['role']=='user' and value['identity']=='Student' and (not old or old.get('class_name') or old.get('role')!='user' or old.get('identity')!='Student'):
        if not value['student_no'] or not value['class_name']: raise Error('A student ID and class are required.')
    value['room'] = value['room'].upper()
    if value['room'] and value['room'] not in rooms(c): raise Error('Select a residence room from the asset register.')
    if value['role'] != 'user': value['room'] = ''
    if value['role'] == 'technician' and not value['skill']: raise Error('Enter a maintenance specialty.')
    if value['role'] != 'technician': value['skill'] = ''
    return value


def record(c, uid, actor, action, changes, note):
    c.execute('INSERT INTO user_events(user_id,actor,action,changes,note,created) VALUES(?,?,?,?,?,?)',
              (uid, actor['id'], action, json.dumps(changes, ensure_ascii=False), note, accounts.now().isoformat(timespec='seconds')))


def handle(c, actor, uid, action, body, digest, Error):
    c.execute('BEGIN IMMEDIATE')
    require_admin(c, actor, Error)
    allowed = {'username', 'password', 'note', *EDITABLE} if action == 'create' else {'version', 'password', 'note'} if action == 'password' else {'version', 'note', *EDITABLE}
    if set(body) - allowed: raise Error('The update contains unsupported fields. Administrators cannot change email verification status.')
    note = str(body.get('note', '')).strip()
    if len(note) > 300: raise Error('The reason for the change must be no more than 300 characters.')
    stamp = accounts.now().isoformat(timespec='seconds')
    if action == 'create':
        uid = str(body.get('username', '')).strip().lower()
        if not re.fullmatch(r'[a-z][a-z0-9_]{3,31}', uid): raise Error('Use 4–32 letters, numbers, or underscores, starting with a letter.')
        if c.execute('SELECT 1 FROM users WHERE id=?', (uid,)).fetchone(): raise Error('This username is already in use.',409)
        value = normalized(c, body, {}, Error)
        secret = accounts.password(body.get('password'), Error)
        salt = secrets.token_hex(16)
        try:
            c.execute('INSERT INTO users(id,name,role,identity,room,skill,student_no,class_name,department,enabled,salt,password,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                      (uid, *[value[k] for k in EDITABLE[:-1]], value['enabled'], salt, digest(secret,salt), stamp, stamp))
        except sqlite3.IntegrityError: raise Error('This username or student or staff ID is already in use.',409)
        record(c, uid, actor, 'create', {k:{'before':None,'after':v} for k,v in value.items()}, note)
    else:
        old = detail(c, uid, Error)
        if type(body.get('version')) is not int or body['version'] != old['version']:
            raise Error('The account changed. Reopen it before making further updates.',409)
        if action == 'password':
            secret = accounts.password(body.get('password'),Error)
            salt = secrets.token_hex(16)
            c.execute('UPDATE users SET salt=?,password=?,version=version+1,updated_at=? WHERE id=?', (salt,digest(secret,salt),stamp,uid))
            record(c,uid,actor,'password',{},note)
        else:
            value = normalized(c, body, old, Error)
            removing_admin = old['role']=='admin' and old['enabled'] and (value['role']!='admin' or not value['enabled'])
            if uid==actor['id'] and (value['role']!='admin' or not value['enabled']): raise Error('You cannot deactivate your own account or remove your administrator role.',409)
            if removing_admin and c.execute("SELECT count(*) FROM users WHERE role='admin' AND enabled=1").fetchone()[0]<=1:
                raise Error('At least one administrator must remain active.',409)
            if old['role']=='technician' and (value['role']!='technician' or not value['enabled']):
                if c.execute("SELECT 1 FROM tickets WHERE assignee=? AND status NOT IN ('closed','cancelled')",(uid,)).fetchone():
                    raise Error('Reassign or complete this technician’s open work orders first.',409)
            changes = {k:{'before':old[k],'after':v} for k,v in value.items() if old[k]!=v}
            if not changes: return {'user':old,'message':'No changes to save.'}
            try:
                c.execute('UPDATE users SET '+','.join(k+'=?' for k in EDITABLE)+',version=version+1,updated_at=? WHERE id=?', (*[value[k] for k in EDITABLE],stamp,uid))
            except sqlite3.IntegrityError: raise Error('This student or staff ID is already in use.',409)
            record(c,uid,actor,'update',changes,note)
        # Re-authenticate after every edit so privileges and passwords cannot remain stale.
        c.execute('DELETE FROM sessions WHERE user_id=?',(uid,))
        if old.get('email'):
            c.execute('UPDATE email_codes SET used=1 WHERE email=?',(old['email'],))
    return {'user':detail(c,uid,Error),'message':'User created.' if action=='create' else 'Changes saved. The user has been signed out of existing sessions.'}
