"""Module 2: transparent engagement scoring and academic risk warnings."""

from datetime import datetime, timedelta, timezone


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def migrate(c):
    c.executescript(
        """
        CREATE TABLE IF NOT EXISTS engagement_events (
            event_key TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
            kind TEXT NOT NULL CHECK (kind IN ('login', 'qa', 'booking')),
            occurred_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS engagement_user_time
            ON engagement_events(user_id, occurred_at DESC);
        CREATE TABLE IF NOT EXISTS academic_risk_reports (
            user_id TEXT PRIMARY KEY REFERENCES users(id), score INTEGER NOT NULL,
            level TEXT NOT NULL, login_count INTEGER NOT NULL, qa_count INTEGER NOT NULL,
            booking_count INTEGER NOT NULL, generated_at TEXT NOT NULL
        );
        """
    )
    c.execute(
        """INSERT OR IGNORE INTO engagement_events(event_key,user_id,kind,occurred_at)
           SELECT 'booking:' || id, requester, 'booking', created_at FROM venue_bookings"""
    )
    c.execute(
        """INSERT OR IGNORE INTO engagement_events(event_key,user_id,kind,occurred_at)
           SELECT 'qa:' || id, user_id, 'qa', created_at FROM qa_history"""
    )


def seed(c):
    if not c.execute("SELECT 1 FROM users WHERE id='student'").fetchone():
        return
    current = datetime.now(timezone.utc)
    for index, days in enumerate((1, 5, 12), 1):
        c.execute(
            "INSERT OR IGNORE INTO engagement_events VALUES (?, 'student', 'login', ?)",
            ("demo-login-{0}".format(index), (current - timedelta(days=days)).isoformat(timespec="seconds")),
        )


def record(c, user_id, kind, event_key=None):
    key = event_key or "{0}:{1}:{2}".format(kind, user_id, datetime.now(timezone.utc).isoformat())
    c.execute(
        "INSERT OR IGNORE INTO engagement_events(event_key,user_id,kind,occurred_at) VALUES(?,?,?,?)",
        (key, user_id, kind, now()),
    )


def calculate(c, user_id):
    since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat(timespec="seconds")
    counts = {
        row["kind"]: row["n"]
        for row in c.execute(
            "SELECT kind,count(*) n FROM engagement_events WHERE user_id=? AND occurred_at>=? GROUP BY kind",
            (user_id, since),
        )
    }
    logins = counts.get("login", 0)
    qa = counts.get("qa", 0)
    bookings = counts.get("booking", 0)
    score = round(min(logins, 8) / 8 * 45 + min(qa, 5) / 5 * 30 + min(bookings, 3) / 3 * 25)
    level = "low" if score >= 60 else "medium" if score >= 30 else "high"
    generated = now()
    c.execute(
        """INSERT INTO academic_risk_reports
           (user_id,score,level,login_count,qa_count,booking_count,generated_at)
           VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
           score=excluded.score,level=excluded.level,login_count=excluded.login_count,
           qa_count=excluded.qa_count,booking_count=excluded.booking_count,
           generated_at=excluded.generated_at""",
        (user_id, score, level, logins, qa, bookings, generated),
    )
    return {
        "user_id": user_id, "score": score, "level": level,
        "counts": {"logins": logins, "questions": qa, "bookings": bookings},
        "generated_at": generated,
        "factors": [
            "Sign-ins in the last 30 days: {0} of 8 target activities".format(logins),
            "Learning-support questions: {0} of 5 target activities".format(qa),
            "Venue-booking activities: {0} of 3 target activities".format(bookings),
        ],
    }


def dashboard(c, user, Error):
    is_faculty = user["role"] == "user" and user["identity"] == "Faculty"
    if user["role"] == "admin" or is_faculty:
        students = c.execute(
            "SELECT id,name,class_name,department FROM users WHERE role='user' AND identity='Student' AND enabled=1 ORDER BY name"
        ).fetchall()
        return {
            "scope": "cohort",
            "students": [dict(student, **calculate(c, student["id"])) for student in students],
            "method": "Rule-based engagement score from sign-ins, cited Q&A usage, and venue-booking activity in the last 30 days.",
        }
    if user["role"] == "user" and user["identity"] == "Student":
        return {
            "scope": "self", "report": calculate(c, user["id"]),
            "method": "Rule-based engagement score from your sign-ins, cited Q&A usage, and venue-booking activity in the last 30 days.",
        }
    raise Error("Academic risk reports are available to students, faculty, and administrators.", 403)
