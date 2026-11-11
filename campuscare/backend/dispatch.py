"""Deterministic maintenance dispatch. Call within a BEGIN IMMEDIATE transaction."""
import secrets
from datetime import datetime, timezone


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def trade_for(category):
    if category in ('Computer', 'Projector'):
        return 'IT'
    if category == 'Plumbing':
        return 'Plumbing'
    if category in ('Furniture', 'Door Lock', 'Fence', 'Road Surface'):
        return 'Carpentry'
    return 'Electrical'


def notify(c, users, title, body):
    for uid in set(users):
        c.execute('INSERT INTO notices(id,user_id,kind,title,body,created) VALUES(?,?,?,?,?,?)',
                  (secrets.token_hex(12), uid, 'maintenance', title, body, now()))


def assign(c, ticket_id, actor, bump_version=True):
    ticket = c.execute('SELECT t.*,a.category FROM tickets t JOIN assets a ON a.id=t.asset_id WHERE t.id=?', (ticket_id,)).fetchone()
    if not ticket or ticket['status'] != 'pending' or ticket['assignee']:
        return False
    trade = trade_for(ticket['category'])
    technician = c.execute(
        "SELECT u.id FROM users u LEFT JOIN tickets t ON t.assignee=u.id "
        "AND t.status NOT IN ('closed','cancelled') "
        "WHERE u.role='technician' AND u.enabled=1 AND lower(trim(u.skill))=lower(?) "
        "GROUP BY u.id ORDER BY count(t.id),u.id LIMIT 1", (trade,)
    ).fetchone()
    if not technician:
        previous = c.execute("SELECT action FROM events WHERE ticket_id=? AND action IN ('dispatch_waiting','auto_assigned','reopen') ORDER BY id DESC LIMIT 1", (ticket_id,)).fetchone()
        if not previous or previous['action'] != 'dispatch_waiting':
            message = f'No available {trade} technician. This work order is waiting for assignment.'
            c.execute('INSERT INTO events(ticket_id,actor,action,note,created) VALUES(?,?,?,?,?)',
                      (ticket_id, actor, 'dispatch_waiting', message, now()))
            admins = [row['id'] for row in c.execute("SELECT id FROM users WHERE role='admin' AND enabled=1")]
            notify(c, admins + [ticket['reporter']], 'Work order awaiting a specialist', f'{ticket_id}: {message}')
        return False
    c.execute("UPDATE tickets SET status='assigned',assignee=?,updated=?,version=version+? WHERE id=?",
              (technician['id'], now(), int(bump_version), ticket_id))
    c.execute('INSERT INTO events(ticket_id,actor,action,note,created) VALUES(?,?,?,?,?)',
              (ticket_id, actor, 'auto_assigned', f"Assigned to {technician['id']} by specialty ({trade}) and open workload.", now()))
    notify(c, [ticket['reporter'], technician['id']], 'Work order automatically assigned',
           f"{ticket_id}: assigned to {technician['id']} ({trade}).")
    return True


def retry_pending(c, actor):
    rows = c.execute("SELECT id FROM tickets WHERE status='pending' AND assignee IS NULL ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,created,id").fetchall()
    return sum(assign(c, row['id'], actor) for row in rows)
