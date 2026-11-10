"""Module 6 — Intelligent Application Pre-review and Notification.

Workflow: applicant submits -> deterministic pre-review -> either returned for
correction (needs_fix) or forwarded to the administrative queue (pre_checked)
-> staff approves / rejects / returns -> applicant is notified in-app and, when
SMTP is configured, by email.

Design notes
------------
* Pre-review never approves or rejects anything. It only blocks incomplete
  submissions and annotates the queue, so a human always makes the decision.
* Every notification is stored in `notices` first; email is a best-effort
  follow-up in a background thread. A failed email never rolls back business
  state, it is recorded as `failed` on the notice.
* Materials live in the database as base64 like module 3 attachments, but are
  re-authorized on download and never returned inside list responses.
"""

import base64
import json
import secrets
import sqlite3
import threading
from datetime import datetime, timedelta, timezone

from . import mailservice
from . import prereview

STATUS = {
    "needs_fix": "Correction Required",
    "pre_checked": "Awaiting Staff Review",
    "approved": "Approved",
    "rejected": "Rejected",
    "returned": "Returned for Correction",
    "withdrawn": "Withdrawn",
}
ACTIVE = ("needs_fix", "returned", "pre_checked")
EVENTS = {
    "submitted": "Application Submitted",
    "resubmitted": "Corrections Resubmitted",
    "approved": "Approved by Staff",
    "rejected": "Rejected by Staff",
    "returned": "Returned for Correction",
    "withdrawn": "Withdrawn by Applicant",
}
LIMIT_MB = prereview.MAX_MATERIAL_MB
_DB_FILE = None


# --------------------------------------------------------------------------
# Schema
# --------------------------------------------------------------------------


def now():
    return datetime.now(timezone.utc)


def stamp():
    return now().isoformat(timespec="seconds")


def migrate(c):
    global _DB_FILE
    _DB_FILE = c.execute("PRAGMA database_list").fetchone()[2] or None
    c.executescript(
        """
    CREATE TABLE IF NOT EXISTS applications(
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        applicant TEXT NOT NULL REFERENCES users(id),
        fields TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL,
        score INTEGER NOT NULL DEFAULT 0,
        errors INTEGER NOT NULL DEFAULT 0,
        warnings INTEGER NOT NULL DEFAULT 0,
        report TEXT NOT NULL DEFAULT '{}',
        reviewer TEXT REFERENCES users(id),
        review_note TEXT NOT NULL DEFAULT '',
        created TEXT,
        updated TEXT,
        decided TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        demo INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS applications_owner ON applications(applicant,created);
    CREATE INDEX IF NOT EXISTS applications_queue ON applications(status,created);
    CREATE TABLE IF NOT EXISTS application_materials(
        id TEXT PRIMARY KEY,
        application_id TEXT NOT NULL REFERENCES applications(id),
        slot TEXT NOT NULL,
        mime TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        size INTEGER NOT NULL DEFAULT 0,
        data TEXT NOT NULL,
        created TEXT
    );
    CREATE INDEX IF NOT EXISTS application_materials_owner ON application_materials(application_id);
    CREATE TABLE IF NOT EXISTS application_events(
        id INTEGER PRIMARY KEY,
        application_id TEXT NOT NULL REFERENCES applications(id),
        actor TEXT REFERENCES users(id),
        action TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created TEXT
    );
    CREATE INDEX IF NOT EXISTS application_events_owner ON application_events(application_id,id);
    CREATE TABLE IF NOT EXISTS notices(
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        application_id TEXT,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        created TEXT,
        read_at TEXT,
        email_state TEXT NOT NULL DEFAULT 'none',
        email_note TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS notices_inbox ON notices(user_id,created);
    """
    )
# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------


def type_of(type_id):
    if type_id not in prereview.CATALOG:
        raise KeyError(type_id)
    return prereview.CATALOG[type_id]


def type_name(type_id):
    kind = prereview.CATALOG.get(type_id)
    return kind["name"] if kind else str(type_id)


def applicant_profile(c, uid):
    row = c.execute(
        "SELECT id,name,identity,student_no,class_name,department,email FROM users WHERE id=?",
        (uid,),
    ).fetchone()
    return dict(row) if row else {}


def own_history(c, uid):
    return [
        dict(r)
        for r in c.execute(
            "SELECT id,type,status,created,decided FROM applications WHERE applicant=?", (uid,)
        )
    ]


def clean_fields(kind, raw):
    """Whitelist catalog fields; unknown keys are dropped instead of stored.

    Values are stored as typed, up to a hard cap, so the rule engine can report a
    real over-length error instead of silently truncating the applicant's text.
    """
    if not isinstance(raw, dict):
        return {}
    result = {}
    for field in kind["fields"]:
        value = raw.get(field["key"], "")
        if value is None:
            value = ""
        if field["type"] == "number":
            value = str(value).strip()[:10]
        elif isinstance(value, str):
            cap = 4000 if field["type"] == "textarea" else 500
            value = value.strip()[:cap]
        else:
            continue
        result[field["key"]] = value
    return result


def valid_materials(raw, Error):
    """Decode and verify uploaded materials; returns rows ready for insertion."""
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise Error("Invalid materials format.")
    if len(raw) > prereview.MAX_MATERIALS:
        raise Error("Upload no more than %d files per application." % prereview.MAX_MATERIALS)
    rows = []
    for item in raw:
        if not isinstance(item, dict):
            raise Error("Invalid materials format.")
        slot = str(item.get("slot", "")).strip()[:40]
        mime = item.get("mime")
        name = str(item.get("name", ""))[:80]
        if not slot:
            raise Error("Each material must include a category.")
        try:
            blob = base64.b64decode(item.get("data", ""), validate=True)
        except (ValueError, TypeError):
            raise Error("A material has invalid encoding. Upload it again.")
        if len(blob) > LIMIT_MB * 1024 * 1024:
            raise Error('"%s" exceeds %d MB.' % (name or slot, LIMIT_MB))
        magic = {
            "image/jpeg": b"\xff\xd8\xff",
            "image/png": b"\x89PNG\r\n\x1a\n",
            "application/pdf": b"%PDF",
        }
        if mime not in magic or not blob.startswith(magic[mime]):
            raise Error('"%s" is not a valid JPEG, PNG, or PDF file.' % (name or slot))
        rows.append({"slot": slot, "mime": mime, "name": name, "size": len(blob), "data": item.get("data")})
    return rows


def meta(rows):
    return [{"slot": r["slot"], "mime": r["mime"], "name": r["name"], "size": r["size"]} for r in rows]


def notice(c, user_id, application_id, kind, title, body, jobs):
    """Store the in-app notice first, then queue an email if delivery is usable."""
    notice_id = "NTC-" + secrets.token_hex(5).upper()
    email_state, email_note = "skipped", "Email delivery is not configured."
    row = c.execute("SELECT email FROM users WHERE id=?", (user_id,)).fetchone()
    recipient = (row["email"] or "").strip() if row else ""
    configured = mailservice.config().get("mode") == "smtp"
    if not recipient:
        email_note = "This account has no verified email; the notice is available in the portal only."
    elif not configured:
        email_note = "Email delivery is not configured; the notice is available in the portal only."
    else:
        email_state, email_note = "queued", ""
        jobs.append(
            {
                "notice_id": notice_id,
                "to": recipient,
                "subject": "[SmartCampus] " + title,
                "text": body + "\n\nThis message was sent automatically by SmartCampus Application Pre-review. Do not reply.",
            }
        )
    c.execute(
        "INSERT INTO notices(id,user_id,application_id,kind,title,body,created,email_state,email_note)"
        " VALUES(?,?,?,?,?,?,?,?,?)",
        (notice_id, user_id, application_id, kind, title, body, stamp(), email_state, email_note),
    )


def staff_ids(c):
    return [r["id"] for r in c.execute("SELECT id FROM users WHERE role='admin' AND enabled=1")]


def dispatch(jobs):
    """Send queued email in a daemon thread; the request never waits on SMTP."""
    if not jobs or not _DB_FILE:
        return

    def run():
        states = []
        for job in jobs:
            try:
                mailservice.send(job["to"], job["subject"], job["text"])
                states.append((job["notice_id"], "sent", ""))
            except Exception as exc:  # noqa: BLE001 - state must be recorded either way
                states.append((job["notice_id"], "failed", type(exc).__name__))
        try:
            with sqlite3.connect(_DB_FILE, timeout=15) as conn:
                for notice_id, state, note in states:
                    conn.execute(
                        "UPDATE notices SET email_state=?,email_note=? WHERE id=?",
                        (state, note, notice_id),
                    )
        except sqlite3.Error:
            pass

    threading.Thread(target=run, daemon=True).start()


def record(c, application_id, actor, action, note):
    c.execute(
        "INSERT INTO application_events(application_id,actor,action,note,created) VALUES(?,?,?,?,?)",
        (application_id, actor, action, note[:1000], stamp()),
    )


# --------------------------------------------------------------------------
# Pre-review
# --------------------------------------------------------------------------


def run_prereview(c, user, type_id, fields, material_meta, exclude=None):
    history = [h for h in own_history(c, user["id"]) if h["id"] != exclude]
    report = prereview.evaluate(type_id, fields, material_meta, applicant_profile(c, user["id"]), history)
    report["advisory_model"] = prereview.model_advisory(type_id, fields, applicant_profile(c, user["id"]))
    return report


def check_only(c, user, body, Error):
    """Live pre-check for the form; stores nothing."""
    if user["role"] != "user":
        raise Error("Use a student or faculty account to submit an application.", 403)
    try:
        kind = type_of(body.get("type"))
    except KeyError:
        raise Error("Select a valid application type.")
    fields = clean_fields(kind, body.get("fields"))
    raw = body.get("materials") or []
    if not isinstance(raw, list) or len(raw) > prereview.MAX_MATERIALS:
        raise Error("Invalid materials format.")
    material_meta = [
        {
            "slot": str(m.get("slot", ""))[:40],
            "mime": m.get("mime"),
            "size": int(m.get("size") or 0),
            "name": str(m.get("name", ""))[:80],
        }
        for m in raw
        if isinstance(m, dict)
    ]
    return run_prereview(c, user, kind["id"], fields, material_meta)


# --------------------------------------------------------------------------
# Read APIs
# --------------------------------------------------------------------------


def summary(c, user):
    if user["role"] == "admin":
        row = dict(
            c.execute(
                """SELECT COALESCE(sum(status='pre_checked'),0) waiting,
                          COALESCE(sum(status='approved'),0) approved,
                          COALESCE(sum(status='rejected'),0) rejected,
                          COALESCE(sum(status='returned'),0) returned
                   FROM applications"""
            ).fetchone()
        )
        waiting = row["waiting"] or 0
        oldest = c.execute("SELECT min(created) FROM applications WHERE status='pre_checked'").fetchone()[0]
        hours = None
        if oldest:
            try:
                hours = round((now() - datetime.fromisoformat(oldest)).total_seconds() / 3600, 1)
            except (ValueError, TypeError):
                hours = None
        row.update(waiting_queue=waiting, oldest_wait_hours=hours)
        row["unread"] = c.execute(
            "SELECT count(*) FROM notices WHERE user_id=? AND read_at IS NULL", (user["id"],)
        ).fetchone()[0]
        return row
    row = dict(
        c.execute(
            """SELECT COALESCE(sum(status IN ('needs_fix','returned')),0) action_needed,
                      COALESCE(sum(status='pre_checked'),0) waiting,
                      COALESCE(sum(status='approved'),0) approved,
                      COALESCE(sum(status='rejected'),0) rejected
               FROM applications WHERE applicant=?""",
            (user["id"],),
        ).fetchone()
    )
    row["unread"] = c.execute(
        "SELECT count(*) FROM notices WHERE user_id=? AND read_at IS NULL", (user["id"],)
    ).fetchone()[0]
    return row


def listing(c, user, query, Error):
    admin = user["role"] == "admin"
    if user["role"] == "technician":
        raise Error("The application module is not available to maintenance accounts.", 403)
    try:
        page = max(1, int(query.get("page", ["1"])[0]))
    except (ValueError, TypeError):
        raise Error("Invalid page number.")
    status = query.get("status", [""])[0]
    type_id = query.get("type", [""])[0]
    q = str(query.get("q", [""])[0]).strip()[:80]
    clauses, args = [], []
    if not admin:
        clauses.append("a.applicant=?")
        args.append(user["id"])
    if status:
        if status not in STATUS:
            raise Error("Invalid status filter.")
        clauses.append("a.status=?")
        args.append(status)
    if type_id:
        if type_id not in prereview.CATALOG:
            raise Error("Invalid application type filter.")
        clauses.append("a.type=?")
        args.append(type_id)
    if q:
        term = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        clauses.append("(a.id LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\' OR a.fields LIKE ? ESCAPE '\\')")
        args.extend([term] * 3)
    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    total = c.execute(
        "SELECT count(*) FROM applications a JOIN users u ON u.id=a.applicant" + where, args
    ).fetchone()[0]
    page = min(page, max(1, (total + 11) // 12))
    rows = [
        dict(r)
        for r in c.execute(
            "SELECT a.id,a.type,a.status,a.score,a.errors,a.warnings,a.created,a.updated,a.decided,"
            "a.review_note,a.demo,a.applicant,u.name applicant_name,u.identity applicant_identity,"
            "r.name reviewer_name FROM applications a JOIN users u ON u.id=a.applicant "
            "LEFT JOIN users r ON r.id=a.reviewer"
            + where
            + " ORDER BY CASE a.status WHEN 'pre_checked' THEN 0 WHEN 'needs_fix' THEN 1 ELSE 2 END, a.created DESC LIMIT 12 OFFSET ?",
            args + [(page - 1) * 12],
        )
    ]
    for row in rows:
        row["type_name"] = type_name(row["type"])
        row["status_label"] = STATUS.get(row["status"], row["status"])
        row["sla"] = type_of(row["type"])["sla"] if row["type"] in prereview.CATALOG else ""
    return {
        "applications": rows,
        "total": total,
        "page": page,
        "page_size": 12,
        "summary": summary(c, user),
        "catalog": prereview.public_catalog(),
        "statuses": STATUS,
    }


def detail(c, user, aid, Error):
    row = c.execute(
        "SELECT a.*,u.name applicant_name,u.identity applicant_identity,u.student_no,u.class_name,"
        "u.department,u.email,r.name reviewer_name FROM applications a JOIN users u ON u.id=a.applicant "
        "LEFT JOIN users r ON r.id=a.reviewer WHERE a.id=?",
        (aid,),
    ).fetchone()
    if not row:
        raise Error("The application was not found.", 404)
    if user["role"] != "admin" and row["applicant"] != user["id"]:
        raise Error("You do not have permission to view this application.", 403)
    item = dict(row)
    item["fields"] = json.loads(item["fields"] or "{}")
    item["report"] = json.loads(item["report"] or "{}")
    item["type_name"] = type_name(item["type"])
    item["status_label"] = STATUS.get(item["status"], item["status"])
    item["catalog_type"] = prereview.CATALOG.get(item["type"], {})
    item["materials"] = [
        dict(r)
        for r in c.execute(
            "SELECT id,slot,mime,name,size,created FROM application_materials WHERE application_id=? ORDER BY created",
            (aid,),
        )
    ]
    item["events"] = [
        dict(r)
        for r in c.execute(
            "SELECT e.*,u.name actor_name FROM application_events e LEFT JOIN users u ON u.id=e.actor "
            "WHERE e.application_id=? ORDER BY e.id",
            (aid,),
        )
    ]
    return item


def material(c, user, mid, Error):
    row = c.execute(
        "SELECT m.*,a.applicant FROM application_materials m JOIN applications a ON a.id=m.application_id WHERE m.id=?",
        (mid,),
    ).fetchone()
    if not row:
        raise Error("The material was not found.", 404)
    if user["role"] != "admin" and row["applicant"] != user["id"]:
        raise Error("You do not have permission to view this material.", 403)
    return row["mime"], base64.b64decode(row["data"]), row["name"]


def notices(c, user, Error):
    rows = [
        dict(r)
        for r in c.execute(
            "SELECT id,application_id,kind,title,body,created,read_at,email_state,email_note FROM notices "
            "WHERE user_id=? ORDER BY created DESC LIMIT 60",
            (user["id"],),
        )
    ]
    return {
        "notices": rows,
        "unread": c.execute(
            "SELECT count(*) FROM notices WHERE user_id=? AND read_at IS NULL", (user["id"],)
        ).fetchone()[0],
    }


def read_notices(c, user, body, Error):
    ids = body.get("ids")
    if ids is None or ids == "all":
        c.execute("UPDATE notices SET read_at=? WHERE user_id=? AND read_at IS NULL", (stamp(), user["id"]))
        return {"ok": True, "unread": 0}
    if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids):
        raise Error("Invalid notification ID format.")
    if len(ids) > 60:
        raise Error("Mark no more than 60 notifications at once.")
    c.execute(
        "UPDATE notices SET read_at=? WHERE user_id=? AND read_at IS NULL AND id IN (%s)"
        % ",".join("?" * len(ids)),
        [stamp(), user["id"]] + ids,
    )
    return {
        "ok": True,
        "unread": c.execute(
            "SELECT count(*) FROM notices WHERE user_id=? AND read_at IS NULL", (user["id"],)
        ).fetchone()[0],
    }


# --------------------------------------------------------------------------
# Write workflow
# --------------------------------------------------------------------------


def _write(c, user, aid, body, mode, Error, jobs):
    kind = type_of(body.get("type")) if mode == "submit" else None
    if mode == "revise":
        existing = c.execute("SELECT * FROM applications WHERE id=?", (aid,)).fetchone()
        if not existing or existing["applicant"] != user["id"]:
            raise Error("The application was not found or you do not have access.", 404)
        if existing["status"] not in ("needs_fix", "returned"):
            raise Error("This application cannot be revised in its current state.", 409)
        if body.get("version") != existing["version"]:
            raise Error("The application changed. Refresh before trying again.", 409)
        kind = type_of(existing["type"])
    fields = clean_fields(kind, body.get("fields"))
    rows = valid_materials(body.get("materials"), Error)
    # Correction keeps materials that were already accepted; a slot that receives
    # new files is replaced as a whole, so nothing is silently dropped or doubled.
    kept = []
    replaced = {row["slot"] for row in rows}
    if mode == "revise" and aid:
        kept = [
            dict(r)
            for r in c.execute(
                "SELECT slot,mime,name,size FROM application_materials WHERE application_id=?", (aid,)
            )
            if r["slot"] not in replaced
        ]
    report = run_prereview(c, user, kind["id"], fields, meta(rows) + kept, exclude=aid)
    status = "pre_checked" if report["decision"] == "ready" else "needs_fix"
    counts = report["counts"]
    aid = aid or "APP-" + datetime.now().strftime("%y%m%d") + "-" + secrets.token_hex(2).upper()
    if mode == "submit":
        c.execute(
            "INSERT INTO applications(id,type,applicant,fields,status,score,errors,warnings,report,created,updated)"
            " VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (
                aid, kind["id"], user["id"], json.dumps(fields, ensure_ascii=False), status,
                report["score"], counts["errors"], counts["warnings"],
                json.dumps(report, ensure_ascii=False), stamp(), stamp(),
            ),
        )
        record(c, aid, user["id"], "submitted", report["headline"])
    else:
        c.execute(
            "UPDATE applications SET fields=?,status=?,score=?,errors=?,warnings=?,report=?,"
            "updated=?,version=version+1,reviewer=NULL,review_note='' WHERE id=?",
            (
                json.dumps(fields, ensure_ascii=False), status, report["score"], counts["errors"],
                counts["warnings"], json.dumps(report, ensure_ascii=False), stamp(), aid,
            ),
        )
        if replaced:
            c.execute(
                "DELETE FROM application_materials WHERE application_id=? AND slot IN (%s)"
                % ",".join("?" * len(replaced)),
                [aid] + sorted(replaced),
            )
        record(c, aid, user["id"], "resubmitted", report["headline"])
    for row in rows:
        c.execute(
            "INSERT INTO application_materials(id,application_id,slot,mime,name,size,data,created)"
            " VALUES(?,?,?,?,?,?,?,?)",
            ("MAT-" + secrets.token_hex(6).upper(), aid, row["slot"], row["mime"], row["name"], row["size"], row["data"], stamp()),
        )

    label = kind["name"]
    if status == "pre_checked":
        body_text = (
            "Pre-review passed with a completeness score of %d%%. The request is now in the staff review queue; the expected response time is %s."
            % (report["score"], kind["sla"])
        )
        if counts["warnings"]:
            body_text += " %d advisory item(s) require staff confirmation." % counts["warnings"]
        for staff in staff_ids(c):
            notice(c, staff, aid, "app_forwarded", "Application awaiting review: " + label,
                   "%s (%s) submitted %s application %s. It passed pre-review with a completeness score of %d%%."
                   % (user["name"], user["id"], label, aid, report["score"]), jobs)
    else:
        body_text = report["headline"] + " Correct the identified items and resubmit the application."
    notice(c, user["id"], aid, "app_result", ("Application submitted: " if mode == "submit" else "Corrections submitted: ") + label
           + (" (pre-review passed)" if status == "pre_checked" else " (correction required)"), body_text, jobs)
    return {"id": aid, "status": status, "status_label": STATUS[status], "report": report}


def submit(c, user, body, Error):
    if user["role"] != "user":
        raise Error("Use a student or faculty account to submit an application.", 403)
    if not isinstance(body.get("fields", {}), dict):
        raise Error("Invalid application form format.")
    c.execute("BEGIN IMMEDIATE")
    jobs = []
    result = _write(c, user, None, body, "submit", Error, jobs)
    c.commit()
    dispatch(jobs)
    return result


def revise(c, user, aid, body, Error):
    if user["role"] != "user":
        raise Error("Use the applicant account to revise this application.", 403)
    c.execute("BEGIN IMMEDIATE")
    jobs = []
    result = _write(c, user, aid, body, "revise", Error, jobs)
    c.commit()
    dispatch(jobs)
    return result


def decide(c, user, aid, body, Error):
    if user["role"] != "admin":
        raise Error("Only administrators can review applications.", 403)
    action = body.get("action")
    if action not in ("approve", "reject", "return"):
        raise Error("Unknown review action.")
    note = str(body.get("note", "")).strip()[:800]
    c.execute("BEGIN IMMEDIATE")
    row = c.execute("SELECT * FROM applications WHERE id=?", (aid,)).fetchone()
    if not row:
        raise Error("The application was not found.", 404)
    if row["status"] != "pre_checked":
        raise Error("This application is no longer awaiting review.", 409)
    if body.get("version") != row["version"]:
        raise Error("Another reviewer updated this application. Refresh before trying again.", 409)
    if action in ("reject", "return") and len(note) < 5:
        raise Error("Enter a specific reason of at least five characters when rejecting or returning an application.")
    target = {"approve": "approved", "reject": "rejected", "return": "returned"}[action]
    c.execute(
        "UPDATE applications SET status=?,reviewer=?,review_note=?,decided=?,updated=?,version=version+1 WHERE id=?",
        (target, user["id"], note, stamp(), stamp(), aid),
    )
    record(c, aid, user["id"], target, note or "The submitted information and materials were verified.")
    label = type_name(row["type"])
    verdict = {"approve": "was approved", "reject": "was rejected", "return": "was returned for correction"}[action]
    body_text = "Your %s application %s %s." % (label, aid, verdict)
    if note:
        body_text += " Review note: " + note
    if action == "return":
        body_text += " Correct the identified items and resubmit the application."
    jobs = []
    notice(c, row["applicant"], aid, "app_decision", "Review decision: " + label, body_text, jobs)
    c.commit()
    dispatch(jobs)
    return {"ok": True, "status": target, "status_label": STATUS[target]}


def withdraw(c, user, aid, body, Error):
    c.execute("BEGIN IMMEDIATE")
    row = c.execute("SELECT * FROM applications WHERE id=?", (aid,)).fetchone()
    if not row or row["applicant"] != user["id"]:
        raise Error("The application was not found or you do not have access.", 404)
    if row["status"] not in ACTIVE:
        raise Error("This application can no longer be withdrawn.", 409)
    note = str(body.get("note", "")).strip()[:300] or "Withdrawn by the applicant."
    c.execute(
        "UPDATE applications SET status='withdrawn',review_note=?,updated=?,version=version+1 WHERE id=?",
        (note, stamp(), aid),
    )
    record(c, aid, user["id"], "withdrawn", note)
    jobs = []
    notice(c, user["id"], aid, "app_result", "Application withdrawn: " + type_name(row["type"]),
           "Application %s was withdrawn. Submit a new application if service is still required." % aid, jobs)
    c.commit()
    dispatch(jobs)
    return {"ok": True, "status": "withdrawn", "status_label": STATUS["withdrawn"]}


# --------------------------------------------------------------------------
# Demo data
# --------------------------------------------------------------------------


def seed(c):
    """Demo profile values plus a few labelled examples for the progress demo."""
    # Demo accounts predate Module 6 and carry no enrollment number. Without one
    # the pre-review could never pass, so fill only the missing demo values.
    demo_profile = {
        "student": ("DEMO-STUDENT-01", "CSIT883 Demo Class", "School of Computing"),
        "teacher": ("GCU-T-1042", "", "School of Computing"),
        "admin": ("GCU-A-0001", "", "Administrative Services"),
    }
    for uid, (number, klass, dept) in demo_profile.items():
        if not c.execute("SELECT 1 FROM users WHERE id=?", (uid,)).fetchone():
            continue
        c.execute(
            "UPDATE users SET student_no=COALESCE(NULLIF(student_no,''),?),"
            "class_name=COALESCE(NULLIF(class_name,''),?),"
            "department=COALESCE(NULLIF(department,''),?) WHERE id=?",
            (number, klass, dept, uid),
        )
    if c.execute("SELECT count(*) FROM applications").fetchone()[0]:
        return
    if not c.execute("SELECT 1 FROM users WHERE id='student'").fetchone():
        return
    base = now()
    demo = [
        {
            "id": "APP-DEMO-001",
            "type": "transcript",
            "fields": {
                "student_no": "DEMO-STUDENT-01", "applicant_name": "Demo Student", "purpose": "Study Abroad",
                "language": "Chinese", "copies": "2", "delivery": "Digital Copy to Campus Email",
                "note": "Exchange-program application with a deadline next month.",
            },
            "status": "needs_fix",
            "materials": [],
            "age": 26,
            "report": None,
        },
        {
            "id": "APP-DEMO-002",
            "type": "enrollment",
            "fields": {
                "student_no": "DEMO-STUDENT-01", "applicant_name": "Demo Student", "recipient": "GCU Community Bank",
                "language": "Bilingual", "valid_until": (base + timedelta(days=90)).date().isoformat(),
                "note": "Required for an education finance application.",
            },
            "status": "pre_checked",
            "materials": [{"slot": "id_copy", "mime": "image/png", "name": "student-card.png", "size": 1024}],
            "age": 8,
            "report": None,
        },
        {
            "id": "APP-DEMO-003",
            "type": "transcript",
            "fields": {
                "student_no": "DEMO-STUDENT-01", "applicant_name": "Demo Student", "purpose": "Employment",
                "language": "Chinese", "copies": "1", "delivery": "Digital Copy to Campus Email", "note": "",
            },
            "status": "approved",
            "materials": [{"slot": "id_copy", "mime": "image/png", "name": "student-card.png", "size": 1024}],
            "age": 24 * 18,
            "report": None,
        },
    ]
    for item in demo:
        created = (base - timedelta(hours=item["age"])).isoformat(timespec="seconds")
        result = prereview.evaluate(
            item["type"], item["fields"], item["materials"],
            applicant_profile(c, "student"),
            [],
            # Each demo row is evaluated on its own so a snapshot never contradicts
            # its stored status; live duplicate checks still use real history.
        )
        c.execute(
            "INSERT INTO applications(id,type,applicant,fields,status,score,errors,warnings,report,created,updated,"
            "decided,version,demo,reviewer,review_note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,2,1,?,?)",
            (
                item["id"], item["type"], "student", json.dumps(item["fields"], ensure_ascii=False),
                item["status"], result["score"], result["counts"]["errors"], result["counts"]["warnings"],
                json.dumps(result, ensure_ascii=False), created, created,
                None if item["status"] in ("needs_fix",) else created, 
                "admin" if item["status"] != "needs_fix" else None,
                "Materials verified; course demonstration record." if item["status"] == "approved" else "",
            ),
        )
        record(c, item["id"], "student", "submitted", "Course demonstration record: " + result["headline"])
        if item["status"] == "approved":
            record(c, item["id"], "admin", "approved", "Materials verified and approved (demo data).")
        for row in item["materials"]:
            blob = _placeholder_png()
            c.execute(
                "INSERT INTO application_materials(id,application_id,slot,mime,name,size,data,created)"
                " VALUES(?,?,?,?,?,?,?,?)",
                (
                    "MAT-" + secrets.token_hex(6).upper(), item["id"], row["slot"], row["mime"],
                    "demo-placeholder.png", len(blob), base64.b64encode(blob).decode(), created,
                ),
            )
    # Notice text is derived from the stored pre-review snapshot so the demo data
    # can never contradict the score shown on the application itself.
    examples = [
        ("APP-DEMO-001", "app_result", 25),
        ("APP-DEMO-002", "app_result", 7),
        ("APP-DEMO-003", "app_decision", 24 * 17),
    ]
    for aid, kind, hours in examples:
        row = c.execute("SELECT type,status,score,report FROM applications WHERE id=?", (aid,)).fetchone()
        report = json.loads(row["report"] or "{}")
        label = type_name(row["type"])
        if row["status"] == "needs_fix":
            title = "Application submitted: %s (correction required)" % label
            body = "%s Correct the identified items and resubmit." % report.get("headline", "")
        elif row["status"] == "pre_checked":
            title = "Application submitted: %s (pre-review passed)" % label
            body = (
                "Pre-review passed with a completeness score of %d%%. The application is in the staff review queue; the expected response time is %s."
                % (row["score"], type_of(row["type"])["sla"])
            )
        else:
            title = "Review decision: %s approved" % label
            body = "Your %s application %s was approved. Review note: materials verified; course demonstration record." % (label, aid)
        c.execute(
            "INSERT INTO notices(id,user_id,application_id,kind,title,body,created,email_state,email_note)"
            " VALUES(?,?,?,?,?,?,?,?,?)",
            (
                "NTC-DEMO-" + secrets.token_hex(4).upper(), "student", aid, kind, title, body,
                (base - timedelta(hours=hours)).isoformat(timespec="seconds"),
                "skipped", "The demo account has no verified email; the notice is available in the portal only.",
            ),
        )
    queue = c.execute(
        "SELECT score,report FROM applications WHERE id='APP-DEMO-002'"
    ).fetchone()
    c.execute(
        "INSERT INTO notices(id,user_id,application_id,kind,title,body,created,email_state,email_note)"
        " VALUES(?,?,?,?,?,?,?,?,?)",
        (
            "NTC-DEMO-QUEUE", "admin", "APP-DEMO-002", "app_forwarded", "Application awaiting review: Proof of Enrollment",
            "Demo Student (student) submitted Proof of Enrollment application APP-DEMO-002. It passed pre-review with a completeness score of %d%%."
            % queue["score"],
            (base - timedelta(hours=7)).isoformat(timespec="seconds"),
            "skipped", "The demo account has no verified email; the notice is available in the portal only.",
        ),
    )
    c.commit()


def _placeholder_png():
    """1x1 transparent PNG: demo rows must never look like a real credential."""
    return base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
    )

