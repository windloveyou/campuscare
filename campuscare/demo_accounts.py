"""Role-only display names and profile defaults for the bundled demo accounts."""

import hashlib

PEOPLE = [
    ("student", "演示学生", "user", "学生", "D1-201", ""),
    ("teacher", "演示教师", "user", "教师", "", ""),
    ("tech", "电工维修员", "technician", "维修人员", "", "电工"),
    ("plumber", "水务维修员", "technician", "维修人员", "", "水务"),
    ("it", "IT 维修员", "technician", "维修人员", "", "IT"),
    ("admin", "校园管理员", "admin", "校园管理人员", "", ""),
]

# Match the original demo labels exactly, without keeping personal names in the
# source. A renamed account or an account edited by an administrator is preserved.
LEGACY_FINGERPRINTS = {
    "student": "eddeec1a42758a98ce7be9b15143c33024b1c6a674d8118a9ec0ac9fcfba8175",
    "teacher": "5a26dad1425e8cd7e9f0940accc5ce265b2fd78f1e81cec231a771ea3ed88c71",
    "tech": "c2d443374abd941b5118d3a1e2a0defb46f47ecb3d884adb5049b7155aa43d05",
    "plumber": "04a31efa2ed4dffee46b434e2a25ca8dbc125477cf686cf80b7e6dca1645a935",
    "it": "26aaa9d83fbb3b77b91bccc3c99a77feb26218585bb904b03601a3abddc0a11d",
    "admin": "30d519d74635b2dc5955a40359e13e7a748fcc62bb24daf43b5da4f15cfe0f82",
}


def fill_demo_student(c):
    number = "DEMO-STUDENT-01"
    if not c.execute(
        "SELECT 1 FROM users WHERE id<>'student' AND student_no=? COLLATE NOCASE", (number,)
    ).fetchone():
        c.execute(
            "UPDATE users SET student_no=COALESCE(NULLIF(student_no,''),?),"
            " class_name=COALESCE(NULLIF(class_name,''),?), department=COALESCE(NULLIF(department,''),?)"
            " WHERE id='student' AND role='user' AND identity='学生'",
            (number, "CSIT883 演示班", "计算机学院"),
        )


def migrate(c):
    for uid, display_name, *_ in PEOPLE:
        row = c.execute(
            "SELECT name FROM users WHERE id=? AND created_at IS NULL", (uid,)
        ).fetchone()
        if not row or not row["name"]:
            continue
        if hashlib.sha256(row["name"].encode()).hexdigest() != LEGACY_FINGERPRINTS[uid]:
            continue
        c.execute("UPDATE users SET name=? WHERE id=?", (display_name, uid))
        if uid == "student" and not c.execute(
            "SELECT 1 FROM user_events WHERE user_id=?", (uid,)
        ).fetchone():
            fill_demo_student(c)
