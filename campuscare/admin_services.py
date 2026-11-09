"""Certificate applications. Shares accounts and transactions with the host app."""

import base64
import binascii
import json
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone

import accounts

PREFIX = "/api/admin-services"
TYPES = {"transcript": "成绩单", "enrollment": "在校证明"}
STATUSES = {
    "pending": "待审批",
    "needs_materials": "待补交材料",
    "approved": "已通过",
    "rejected": "未通过",
}
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
    c.execute("CREATE INDEX IF NOT EXISTS admin_service_reviewer_queue ON admin_service_applications(reviewer_id,status)")


def matches(path):
    return path == PREFIX or path.startswith(PREFIX + "/")


def access(user, Error):
    if user["role"] == "admin":
        return "reviewer"
    if user["role"] == "user" and user["identity"] == "学生":
        return "student"
    raise Error("行政服务仅面向学生和管理人员", 403)


def profile_for(user):
    return {key: user.get(key) or "" for key in PROFILE_FIELDS}


def submitted_profile(user, edits, Error):
    if not isinstance(edits, dict) or edits.keys() - set(PROFILE_FIELDS):
        raise Error("申请资料格式无效")
    values = {**profile_for(user), **edits}
    name = text_field(values["name"], 50, "姓名", Error, required=True)
    if len(name) < 2:
        raise Error("姓名需 2–50 个字符")
    number = text_field(values["student_no"], 30, "学号", Error, required=True)
    if not re.fullmatch(r"[A-Za-z0-9-]{3,30}", number):
        raise Error("学号需 3–30 位字母、数字或连字符")
    email = text_field(values["email"], 254, "邮箱", Error)
    return {
        "name": name,
        "student_no": number.upper(),
        "class_name": text_field(values["class_name"], 80, "班级", Error),
        "department": text_field(values["department"], 80, "院系", Error),
        "email": accounts.email_address(email, Error) if email else "",
    }


def timestamp():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def get_application(c, user, mode, app_id, Error):
    row = c.execute(
        "SELECT * FROM admin_service_applications WHERE id=?", (app_id,)
    ).fetchone()
    if row is None or (mode == "student" and row["applicant_id"] != user["id"]):
        raise Error("申请不存在或无权查看", 404)
    return row


def application_view(row, mode):
    result = dict(row)
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
        "SELECT a.id,a.document_type,a.profile,a.status,a.created,a.updated"
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
        raise Error("仅管理员可按经办人筛选", 403)
    if owner not in ("", "mine", "unassigned"):
        raise Error("经办人筛选条件无效")
    if (status and status not in STATUSES) or (document_type and document_type not in TYPES):
        raise Error("查询条件无效")
    if not re.fullmatch(r"[1-9][0-9]{0,8}", raw_page) or not re.fullmatch(r"[A-Z0-9-]{0,24}", number):
        raise Error("请输入有效的申请编号或页码")
    page = int(raw_page)
    filters, values = visible_scope(user, mode)
    for expression, value in (("a.status=?", status), ("a.document_type=?", document_type), ("instr(a.id,?)>0", number)):
        if value:
            filters.append(expression)
            values.append(value)
    if owner == "mine":
        filters.append("a.reviewer_id=?")
        values.append(user["id"])
    elif owner == "unassigned":
        filters.append("reviewer.id IS NULL")
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
    for row in c.execute("SELECT a.status,count(*) AS n" + APPLICATION_SOURCE + where + " GROUP BY a.status", values):
        counts[row["status"]] = row["n"]
    result = {"counts": counts, "recent": application_rows(c, mode, where, values, 4)}
    if mode == "reviewer":
        row = c.execute(
            "SELECT count(CASE WHEN reviewer.id=? THEN 1 END) AS mine,"
            " count(CASE WHEN reviewer.id IS NULL THEN 1 END) AS unassigned"
            + APPLICATION_SOURCE + " WHERE a.status='pending'", (user["id"],),
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
        raise Error("接口不存在", 404)
    app_id, file_id = match.groups()
    c.execute("BEGIN")
    row = get_application(c, user, mode, app_id, Error)
    if file_id is not None:
        material = c.execute(
            "SELECT filename,data FROM admin_service_materials WHERE id=? AND application_id=?",
            (file_id, app_id),
        ).fetchone()
        if material is None:
            raise Error("材料不存在", 404)
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
        if result["assignment"]["mine"] and row["status"] in ("pending", "needs_materials"):
            result["reviewers"] = [dict(person) for person in c.execute(
                "SELECT id,name FROM users WHERE role='admin' AND enabled=1 AND id<>? ORDER BY name,id",
                (user["id"],),
            )]
    return result


def text_field(value, limit, label, Error, required=False):
    if not isinstance(value, str) or re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff]", value):
        raise Error(f"{label}格式无效")
    value = value.strip()
    if len(value) > limit or (required and not value):
        raise Error(f"请填写{label}（最多 {limit} 字）" if required else f"{label}最多 {limit} 字")
    return value


def validate_materials(files, Error, required=False):
    if not isinstance(files, list) or len(files) > MAX_FILES:
        raise Error(f"每次最多上传 {MAX_FILES} 份材料")
    if required and not files:
        raise Error("请至少上传一份补交材料")
    materials = []
    for file in files:
        if not isinstance(file, dict):
            raise Error("材料格式无效")
        filename, encoded = file.get("filename"), file.get("data")
        if not isinstance(filename, str) or not re.fullmatch(r"[^/\\<>:\"|?*\x00-\x1f\x7f\ud800-\udfff]{1,120}", filename):
            raise Error("材料文件名无效或超过 120 个字符")
        kind = FILE_TYPES.get(filename.rpartition(".")[2].lower())
        if kind is None:
            raise Error("材料仅支持 PDF、PNG、JPG")
        if not isinstance(encoded, str):
            raise Error("材料内容无效")
        if len(encoded) > 4 * ((MAX_FILE_BYTES + 2) // 3):
            raise Error("每份材料不能超过 2 MB", 413)
        try:
            data = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error):
            raise Error("材料内容无效") from None
        if len(data) > MAX_FILE_BYTES:
            raise Error("每份材料不能超过 2 MB", 413)
        if len(data) <= len(kind[1]) or not data.startswith(kind[1]):
            raise Error("材料内容与扩展名不符或文件为空")
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
    if row["status"] not in ("pending", "needs_materials"):
        raise Error("已结束的申请不能变更经办人", 409)
    reviewer = active_reviewer(c, row["reviewer_id"])
    operation = body.get("operation")
    note = text_field(body.get("note", ""), 300, "交接说明", Error)
    if operation == "claim":
        if reviewer:
            raise Error("这条申请已有经办人，请刷新详情", 409)
        target_id, event = user["id"], "claimed"
        description = "原经办人已不可办理，已重新领取。" if row["reviewer_id"] else "已领取申请。"
    elif operation in ("release", "transfer"):
        if not reviewer or reviewer["id"] != user["id"]:
            raise Error("仅当前经办人可以转交或交回申请", 403)
        if operation == "release":
            target_id, event, description = None, "released", "已交回待领取队列。"
        else:
            target = body.get("reviewer_id")
            if not isinstance(target, str) or target == user["id"] or not re.fullmatch(r"[a-z][a-z0-9_]{3,31}", target):
                raise Error("请选择其他启用的管理员")
            person = active_reviewer(c, target)
            if not person:
                raise Error("目标管理员已不可办理，请刷新后重新选择", 409)
            target_id, event, description = person["id"], "transferred", f"已转交给 {person['name']}（{person['id']}）。"
    else:
        raise Error("经办操作无效")
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
            raise Error("仅学生可提交申请", 403)
        profile = submitted_profile(user, body.get("profile", {}), Error)
        document_type = body.get("document_type")
        if not isinstance(document_type, str) or document_type not in TYPES:
            raise Error("请选择有效的申请类型")
        purpose = text_field(body.get("purpose", ""), 300, "申请用途", Error, required=True)
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

    match = re.fullmatch(PREFIX + r"/applications/([^/]+)/(decision|materials|assignment)", path)
    if not match:
        raise Error("接口不存在", 404)
    app_id, action = match.groups()
    if action in ("decision", "assignment") and mode != "reviewer":
        raise Error("仅管理员可办理审批或分配经办人", 403)
    if action == "materials" and mode != "student":
        raise Error("仅申请学生可补交材料", 403)
    row = get_application(c, user, mode, app_id, Error)
    if type(body.get("version")) is not int or body["version"] != row["version"]:
        raise Error("申请已更新，请刷新详情后再操作", 409)
    if action == "assignment":
        return change_assignment(c, row, user, body, stamp, Error)
    reviewer_id = row["reviewer_id"]
    if action == "decision":
        if row["status"] != "pending":
            raise Error("只有待审批申请可以审批", 409)
        reviewer = active_reviewer(c, reviewer_id)
        if reviewer and reviewer["id"] != user["id"]:
            raise Error("此申请由其他管理员经办，请联系当前经办人转交", 403)
        reviewer_id = user["id"]
        status = body.get("decision")
        if status not in ("approved", "rejected", "needs_materials"):
            raise Error("请选择有效的审批结果")
        note = text_field(body.get("note", ""), 500, "审批说明", Error, required=status != "approved")
        event, materials = status, []
    else:
        if row["status"] != "needs_materials":
            raise Error("只有待补交材料的申请可以补交", 409)
        note = text_field(body.get("note", ""), 500, "补充说明", Error)
        materials = validate_materials(body.get("materials", []), Error, required=True)
        event, status = "supplemented", "pending"
    c.execute(
        "UPDATE admin_service_applications SET status=?,reviewer_id=?,version=version+1,updated=? WHERE id=?",
        (status, reviewer_id, stamp, app_id),
    )
    record(c, app_id, user["id"], event, note, stamp, materials)
    return {"id": app_id, "status": status, "version": row["version"] + 1}, 200
