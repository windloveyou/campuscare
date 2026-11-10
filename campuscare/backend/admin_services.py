"""Certificate applications. Shares accounts and transactions with the host app."""

import base64
import binascii
import json
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone

from . import accounts

PREFIX = "/api/admin-services"
TYPES = {"transcript": "Transcript", "enrollment": "Proof of Enrollment"}
STATUSES = {
    "pending": "Pending Review",
    "needs_materials": "Awaiting Documents",
    "approved": "Approved",
    "rejected": "Rejected",
    "cancelled": "Canceled",
}
OPEN_STATUSES = ("pending", "needs_materials")
PROFILE_FIELDS = ("name", "student_no", "class_name", "department", "email")
FILE_TYPES = {
    "pdf": ("application/pdf", b"%PDF-"),
    "png": ("image/png", b"\x89PNG\r\n\x1a\n"),
    "jpg": ("image/jpeg", b"\xff\xd8\xff"),
    "jpeg": ("image/jpeg", b"\xff\xd8\xff"),
}
MAX_FILES = 3
MAX_FILE_BYTES = 2 * 1024 * 1024
PAGE_SIZE = 20
ASSIGNMENT_EVENTS = ("claimed", "released", "transferred")
APPLICATION_SOURCE = (
    " FROM admin_service_applications a LEFT JOIN users reviewer"
    " ON reviewer.id=a.reviewer_id AND reviewer.role='admin' AND reviewer.enabled=1"
)
# Withdrawal is recorded separately so existing workflow rows, attachments and
# foreign keys can be kept intact when upgrading a database.
APPLICATION_STATUS = "CASE WHEN a.cancelled_at IS NOT NULL THEN 'cancelled' ELSE a.status END"


@dataclass(frozen=True)
class Download:
    filename: str
    data: bytes


def migrate(c):
    c.executescript("""
        CREATE TABLE IF NOT EXISTS admin_service_applications(
            id TEXT PRIMARY KEY, applicant_id TEXT NOT NULL REFERENCES users(id),
            document_type TEXT NOT NULL CHECK(document_type IN ('transcript','enrollment')),
            profile TEXT NOT NULL, purpose TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('pending','needs_materials','approved','rejected')),
            version INTEGER NOT NULL DEFAULT 1, created TEXT NOT NULL, updated TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS admin_service_applicant_queue
            ON admin_service_applications(applicant_id, updated DESC, id DESC);
        CREATE INDEX IF NOT EXISTS admin_service_review_queue
            ON admin_service_applications(status, updated DESC, id DESC);
        CREATE TABLE IF NOT EXISTS admin_service_events(
            id INTEGER PRIMARY KEY, application_id TEXT NOT NULL REFERENCES admin_service_applications(id),
            actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL,
            note TEXT NOT NULL, created TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS admin_service_event_lookup
            ON admin_service_events(application_id, id);
        CREATE TABLE IF NOT EXISTS admin_service_materials(
            id TEXT PRIMARY KEY, application_id TEXT NOT NULL REFERENCES admin_service_applications(id),
            event_id INTEGER NOT NULL REFERENCES admin_service_events(id),
            filename TEXT NOT NULL, data BLOB NOT NULL
        );
        CREATE INDEX IF NOT EXISTS admin_service_material_lookup
            ON admin_service_materials(application_id, event_id);
    """)
    columns = {column["name"] for column in c.execute("PRAGMA table_info(admin_service_applications)")}
    if "reviewer_id" not in columns:
        c.execute("ALTER TABLE admin_service_applications ADD COLUMN reviewer_id TEXT REFERENCES users(id)")
    if "cancelled_at" not in columns:
        c.execute("ALTER TABLE admin_service_applications ADD COLUMN cancelled_at TEXT")
    c.execute("CREATE INDEX IF NOT EXISTS admin_service_reviewer_queue ON admin_service_applications(reviewer_id,status)")


def matches(path):
    return path == PREFIX or path.startswith(PREFIX + "/")


def access(user, Error):
    if user["role"] == "admin":
        return "reviewer"
    if user["role"] == "user" and user["identity"] == "Student":
        return "student"
    raise Error("Administrative Services is available to students and administrators.", 403)


def profile_for(user):
    return {key: user.get(key) or "" for key in PROFILE_FIELDS}


def submitted_profile(user, edits, Error):
    if not isinstance(edits, dict) or edits.keys() - set(PROFILE_FIELDS):
        raise Error("Invalid application details.")
    values = {**profile_for(user), **edits}
    name = text_field(values["name"], 50, "name", Error, required=True)
    if len(name) < 2:
        raise Error("The name must be 2–50 characters.")
    number = text_field(values["student_no"], 30, "student ID", Error, required=True)
    if not re.fullmatch(r"[A-Za-z0-9-]{3,30}", number):
        raise Error("The student ID must contain 3–30 letters, numbers, or hyphens.")
    email = text_field(values["email"], 254, "email", Error)
    return {
        "name": name,
        "student_no": number.upper(),
        "class_name": text_field(values["class_name"], 80, "class", Error),
        "department": text_field(values["department"], 80, "department", Error),
        "email": accounts.email_address(email, Error) if email else "",
    }


def timestamp():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def get_application(c, user, mode, app_id, Error):
    row = c.execute(
        "SELECT a.*, " + APPLICATION_STATUS + " AS effective_status FROM admin_service_applications a WHERE a.id=?",
        (app_id,),
    ).fetchone()
    if row is None or (mode == "student" and row["applicant_id"] != user["id"]):
        raise Error("The application was not found or you do not have access.", 404)
    return row


def application_view(row, mode):
    result = dict(row)
    result["status"] = result.pop("effective_status")
    result.pop("cancelled_at")
    result["profile"] = json.loads(result["profile"])
    if mode == "student":
        result.pop("applicant_id")
        result.pop("reviewer_id")
    return result


def visible_scope(user, mode):
    if mode == "student":
        return ["a.applicant_id=?"], [user["id"]]
    return [], []


def application_rows(c, mode, where, values, limit, offset=0):
    applications = []
    reviewer_columns = ",reviewer.id AS reviewer_id,reviewer.name AS reviewer_name" if mode == "reviewer" else ""
    for row in c.execute(
        "SELECT a.id,a.document_type,a.profile," + APPLICATION_STATUS + " AS status,a.created,a.updated"
        + reviewer_columns + APPLICATION_SOURCE + where + " ORDER BY a.updated DESC,a.id DESC LIMIT ? OFFSET ?",
        (*values, limit, offset),
    ):
        item = dict(row)
        snapshot = json.loads(item.pop("profile"))
        if mode == "reviewer":
            item.update(name=snapshot["name"], student_no=snapshot["student_no"])
        applications.append(item)
    return applications


def listing(c, user, mode, query, Error):
    status = query.get("status", [""])[0]
    document_type = query.get("type", [""])[0]
    number = query.get("q", [""])[0].strip().upper()
    raw_page = query.get("page", ["1"])[0]
    owner = query.get("owner", [""])[0]
    if owner and mode != "reviewer":
        raise Error("Only administrators can filter by reviewer.", 403)
    if owner not in ("", "mine", "unassigned"):
        raise Error("Invalid reviewer filter.")
    if (status and status not in STATUSES) or (document_type and document_type not in TYPES):
        raise Error("Invalid search criteria.")
    if not re.fullmatch(r"[1-9][0-9]{0,8}", raw_page) or not re.fullmatch(r"[A-Z0-9-]{0,24}", number):
        raise Error("Enter a valid application reference or page number.")
    page = int(raw_page)
    filters, values = visible_scope(user, mode)
    if status == "cancelled":
        filters.append("a.cancelled_at IS NOT NULL")
    elif status:
        filters.extend(("a.status=?", "a.cancelled_at IS NULL"))
        values.append(status)
    for expression, value in (("a.document_type=?", document_type), ("instr(a.id,?)>0", number)):
        if value:
            filters.append(expression)
            values.append(value)
    if owner == "mine":
        filters.append("a.reviewer_id=?")
        values.append(user["id"])
    elif owner == "unassigned":
        filters.extend(("reviewer.id IS NULL", "a.cancelled_at IS NULL"))
    where = " WHERE " + " AND ".join(filters) if filters else ""
    c.execute("BEGIN")
    total = c.execute("SELECT count(*)" + APPLICATION_SOURCE + where, values).fetchone()[0]
    applications = application_rows(c, mode, where, values, PAGE_SIZE, (page - 1) * PAGE_SIZE)
    return {"applications": applications, "total": total, "page": page, "page_size": PAGE_SIZE}


def summary(c, user, mode):
    filters, values = visible_scope(user, mode)
    where = " WHERE " + " AND ".join(filters) if filters else ""
    c.execute("BEGIN")
    counts = dict.fromkeys(STATUSES, 0)
    for row in c.execute(
        "SELECT " + APPLICATION_STATUS + " AS effective_status,count(*) AS n"
        + APPLICATION_SOURCE + where + " GROUP BY effective_status", values,
    ):
        counts[row["effective_status"]] = row["n"]
    result = {"counts": counts, "recent": application_rows(c, mode, where, values, 4)}
    if mode == "reviewer":
        row = c.execute(
            "SELECT count(CASE WHEN reviewer.id=? THEN 1 END) AS mine,"
            " count(CASE WHEN reviewer.id IS NULL THEN 1 END) AS unassigned"
            + APPLICATION_SOURCE + " WHERE a.status='pending' AND a.cancelled_at IS NULL", (user["id"],),
        ).fetchone()
        result["workload"] = dict(row)
    return result


def active_reviewer(c, reviewer_id):
    return c.execute(
        "SELECT id,name FROM users WHERE id=? AND role='admin' AND enabled=1", (reviewer_id,),
    ).fetchone()


def read(c, user, path, query, Error):
    mode = access(user, Error)
    if path == PREFIX + "/catalog":
        profile = profile_for(user) if mode == "student" else None
        return {
            "mode": mode, "types": TYPES, "statuses": STATUSES, "profile": profile,
            "can_apply": mode == "student",
            "materials": {"max_files": MAX_FILES, "max_bytes": MAX_FILE_BYTES, "extensions": list(FILE_TYPES)},
        }
    if path == PREFIX + "/applications":
        return listing(c, user, mode, query, Error)
    if path == PREFIX + "/summary":
        return summary(c, user, mode)
    match = re.fullmatch(PREFIX + r"/applications/([^/]+)(?:/materials/([^/]+))?", path)
    if not match:
        raise Error("Endpoint not found.", 404)
    app_id, file_id = match.groups()
    c.execute("BEGIN")
    row = get_application(c, user, mode, app_id, Error)
    if file_id is not None:
        material = c.execute(
            "SELECT filename,data FROM admin_service_materials WHERE id=? AND application_id=?",
            (file_id, app_id),
        ).fetchone()
        if material is None:
            raise Error("Attachment not found.", 404)
        return Download(material["filename"], material["data"])
    event_columns = "id,action,note,created" + (",actor_id" if mode == "reviewer" else "")
    student_filter = " AND action NOT IN (?,?,?)" if mode == "student" else ""
    result = {
        "application": application_view(row, mode),
        "events": [dict(event) for event in c.execute(
            "SELECT " + event_columns + " FROM admin_service_events WHERE application_id=?" + student_filter + " ORDER BY id",
            (app_id, *ASSIGNMENT_EVENTS) if student_filter else (app_id,),
        )],
        "materials": [dict(file) for file in c.execute(
            "SELECT id,event_id,filename,length(data) size FROM admin_service_materials"
            " WHERE application_id=? ORDER BY event_id, rowid", (app_id,),
        )],
    }
    if mode == "reviewer":
        account = c.execute(
            "SELECT name,student_no,class_name,department,email FROM users WHERE id=?",
            (row["applicant_id"],),
        ).fetchone()
        result["account_profile"] = profile_for(dict(account))
        reviewer = active_reviewer(c, row["reviewer_id"])
        result["assignment"] = {
            "reviewer": dict(reviewer) if reviewer else None,
            "inactive": bool(row["reviewer_id"] and not reviewer),
            "mine": bool(reviewer and reviewer["id"] == user["id"]),
        }
        if result["assignment"]["mine"] and row["effective_status"] in OPEN_STATUSES:
            result["reviewers"] = [dict(person) for person in c.execute(
                "SELECT id,name FROM users WHERE role='admin' AND enabled=1 AND id<>? ORDER BY name,id",
                (user["id"],),
            )]
    return result


def text_field(value, limit, label, Error, required=False):
    if not isinstance(value, str) or re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff]", value):
        raise Error(f"Invalid {label}.")
    value = value.strip()
    if len(value) > limit or (required and not value):
        raise Error(f"Enter {label} (up to {limit} characters)." if required else f"{label} must be no more than {limit} characters.")
    return value


def validate_materials(files, Error, required=False):
    if not isinstance(files, list) or len(files) > MAX_FILES:
        raise Error(f"Upload up to {MAX_FILES} attachments at a time.")
    if required and not files:
        raise Error("Upload at least one additional document.")
    materials = []
    for file in files:
        if not isinstance(file, dict):
            raise Error("Invalid attachment format.")
        filename, encoded = file.get("filename"), file.get("data")
        if not isinstance(filename, str) or not re.fullmatch(r"[^/\\<>:\"|?*\x00-\x1f\x7f\ud800-\udfff]{1,120}", filename):
            raise Error("The attachment filename is invalid or exceeds 120 characters.")
        kind = FILE_TYPES.get(filename.rpartition(".")[2].lower())
        if kind is None:
            raise Error("Attachments must be PDF, PNG, or JPG.")
        if not isinstance(encoded, str):
            raise Error("The attachment could not be read.")
        if len(encoded) > 4 * ((MAX_FILE_BYTES + 2) // 3):
            raise Error("Each attachment must be 2 MB or smaller.", 413)
        try:
            data = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error):
            raise Error("The attachment could not be read.") from None
        if len(data) > MAX_FILE_BYTES:
            raise Error("Each attachment must be 2 MB or smaller.", 413)
        if len(data) <= len(kind[1]) or not data.startswith(kind[1]):
            raise Error("The file is empty or does not match its extension.")
        materials.append((filename, data))
    return materials


def record(c, app_id, actor_id, action, note, stamp, materials=()):
    event_id = c.execute(
        "INSERT INTO admin_service_events(application_id,actor_id,action,note,created) VALUES(?,?,?,?,?)",
        (app_id, actor_id, action, note, stamp),
    ).lastrowid
    c.executemany(
        "INSERT INTO admin_service_materials(id,application_id,event_id,filename,data) VALUES(?,?,?,?,?)",
        [(secrets.token_hex(16), app_id, event_id, name, data) for name, data in materials],
    )


def change_assignment(c, row, user, body, stamp, Error):
    if row["effective_status"] not in OPEN_STATUSES:
        raise Error("A closed application cannot be reassigned.", 409)
    reviewer = active_reviewer(c, row["reviewer_id"])
    operation = body.get("operation")
    note = text_field(body.get("note", ""), 300, "handoff note", Error)
    if operation == "claim":
        if reviewer:
            raise Error("This application already has a reviewer. Refresh its details.", 409)
        target_id, event = user["id"], "claimed"
        description = "Application reclaimed because the previous reviewer is unavailable." if row["reviewer_id"] else "Application claimed."
    elif operation in ("release", "transfer"):
        if not reviewer or reviewer["id"] != user["id"]:
            raise Error("Only the current reviewer can reassign or return this application.", 403)
        if operation == "release":
            target_id, event, description = None, "released", "Application returned to the unassigned queue."
        else:
            target = body.get("reviewer_id")
            if not isinstance(target, str) or target == user["id"] or not re.fullmatch(r"[a-z][a-z0-9_]{3,31}", target):
                raise Error("Select another active administrator.")
            person = active_reviewer(c, target)
            if not person:
                raise Error("That administrator is no longer available. Refresh and select another.", 409)
            target_id, event, description = person["id"], "transferred", f"Reassigned to {person['name']} ({person['id']})."
    else:
        raise Error("Invalid reviewer assignment action.")
    c.execute(
        "UPDATE admin_service_applications SET reviewer_id=?,version=version+1,updated=? WHERE id=?",
        (target_id, stamp, row["id"]),
    )
    record(c, row["id"], user["id"], event, description + ("\n" + note if note else ""), stamp)
    return {"id": row["id"], "status": row["status"], "version": row["version"] + 1}, 200


def write(c, user, path, body, Error):
    """Host starts a write transaction before authenticating and commits on success."""
    mode = access(user, Error)
    stamp = timestamp()
    if path == PREFIX + "/applications":
        if mode != "student":
            raise Error("Only students can submit applications.", 403)
        profile = submitted_profile(user, body.get("profile", {}), Error)
        document_type = body.get("document_type")
        if not isinstance(document_type, str) or document_type not in TYPES:
            raise Error("Select a valid document type.")
        purpose = text_field(body.get("purpose", ""), 300, "purpose", Error, required=True)
        materials = validate_materials(body.get("materials", []), Error)
        app_id = "AS-" + secrets.token_hex(8).upper()
        c.execute(
            "INSERT INTO admin_service_applications"
            "(id,applicant_id,document_type,profile,purpose,status,created,updated)"
            " VALUES(?,?,?,?,?,'pending',?,?)",
            (app_id, user["id"], document_type, json.dumps(profile, ensure_ascii=False), purpose, stamp, stamp),
        )
        record(c, app_id, user["id"], "submitted", "", stamp, materials)
        return {"id": app_id, "status": "pending", "version": 1}, 201

    match = re.fullmatch(PREFIX + r"/applications/([^/]+)/(decision|materials|assignment|cancel)", path)
    if not match:
        raise Error("Endpoint not found.", 404)
    app_id, action = match.groups()
    if action in ("decision", "assignment") and mode != "reviewer":
        raise Error("Only administrators can review applications or assign reviewers.", 403)
    if action == "materials" and mode != "student":
        raise Error("Only the applicant can upload additional documents.", 403)
    if action == "cancel" and mode != "student":
        raise Error("Only the applicant can cancel the application.", 403)
    row = get_application(c, user, mode, app_id, Error)
    if type(body.get("version")) is not int or body["version"] != row["version"]:
        raise Error("The application has changed. Refresh its details and try again.", 409)
    if action == "assignment":
        return change_assignment(c, row, user, body, stamp, Error)
    if action == "cancel":
        if row["effective_status"] not in OPEN_STATUSES:
            raise Error("Only applications pending review or awaiting documents can be canceled.", 409)
        c.execute(
            "UPDATE admin_service_applications SET cancelled_at=?,updated=?,version=version+1 WHERE id=?",
            (stamp, stamp, app_id),
        )
        record(c, app_id, user["id"], "cancelled", "", stamp)
        return {"id": app_id, "status": "cancelled", "version": row["version"] + 1}, 200
    reviewer_id = row["reviewer_id"]
    if action == "decision":
        if row["effective_status"] != "pending":
            raise Error("Only applications pending review can be decided.", 409)
        reviewer = active_reviewer(c, reviewer_id)
        if reviewer and reviewer["id"] != user["id"]:
            raise Error("This application is assigned to another administrator. Ask them to reassign it.", 403)
        reviewer_id = user["id"]
        status = body.get("decision")
        if status not in ("approved", "rejected", "needs_materials"):
            raise Error("Select a valid review decision.")
        note = text_field(body.get("note", ""), 500, "reviewer comments", Error, required=status != "approved")
        event, materials = status, []
    else:
        if row["effective_status"] != "needs_materials":
            raise Error("Additional documents can only be submitted when requested.", 409)
        note = text_field(body.get("note", ""), 500, "additional notes", Error)
        materials = validate_materials(body.get("materials", []), Error, required=True)
        event, status = "supplemented", "pending"
    c.execute(
        "UPDATE admin_service_applications SET status=?,reviewer_id=?,version=version+1,updated=? WHERE id=?",
        (status, reviewer_id, stamp, app_id),
    )
    record(c, app_id, user["id"], event, note, stamp, materials)
    return {"id": app_id, "status": status, "version": row["version"] + 1}, 200
