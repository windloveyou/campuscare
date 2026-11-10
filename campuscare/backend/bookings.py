"""Campus venue inventory, reservations, and in-app approval notifications."""

import secrets
from datetime import datetime, timezone


VENUES = (
    ("A-101", "Academic Building A, Room 101", "Classroom", "Academic Building A · First Floor", 60),
    ("B-201", "Academic Building B, Room 201", "Classroom", "Academic Building B · Second Floor", 45),
    ("B-LAB", "Computer Laboratory", "Laboratory", "Academic Building B · Third Floor", 32),
    ("A-MEET", "Academic Building A Meeting Room", "Meeting Room", "Academic Building A · Third Floor", 18),
    ("GYM-1", "Sports Hall Court 1", "Sports Venue", "Campus Sports Precinct", 40),
)

ACTIONS = {
    "/api/bookings": "create",
    "/api/bookings/review": "review",
    "/api/bookings/cancel": "cancel",
    "/api/bookings/read": "read",
}


def migrate(c):
    c.executescript(
        """
        CREATE TABLE IF NOT EXISTS venues (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
            location TEXT NOT NULL, capacity INTEGER NOT NULL CHECK (capacity > 0)
        );
        CREATE TABLE IF NOT EXISTS venue_bookings (
            id TEXT PRIMARY KEY,
            venue_id TEXT NOT NULL REFERENCES venues(id),
            requester TEXT NOT NULL REFERENCES users(id),
            start_at TEXT NOT NULL, end_at TEXT NOT NULL,
            purpose TEXT NOT NULL, created_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
            reviewer TEXT REFERENCES users(id),
            decision TEXT CHECK (decision IN ('approved', 'rejected')),
            review_note TEXT NOT NULL DEFAULT '',
            decided_at TEXT, read_at TEXT,
            CHECK (start_at < end_at)
        );
        CREATE INDEX IF NOT EXISTS venue_bookings_slots
            ON venue_bookings(venue_id, status, start_at, end_at);
        CREATE INDEX IF NOT EXISTS venue_bookings_requester
            ON venue_bookings(requester, created_at);
        """
    )
    c.executemany("INSERT OR IGNORE INTO venues VALUES (?, ?, ?, ?, ?)", VENUES)


def timestamp(value, Error):
    if isinstance(value, str) and len(value) <= 35:
        try:
            if value.endswith("Z"):
                value = value[:-1] + "+00:00"
            dt = datetime.fromisoformat(value)
            if dt.utcoffset() is not None and not (dt.second or dt.microsecond):
                return dt.astimezone(timezone.utc).isoformat(timespec="seconds")
        except (ValueError, OverflowError):
            pass
    raise Error("Select a valid booking time to the minute and include a time zone.")


def interval(start, end, Error):
    start, end = timestamp(start, Error), timestamp(end, Error)
    if end <= start:
        raise Error("The end time must be later than the start time.")
    return start, end


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def allow(user, Error, role=None):
    if role and user["role"] != role:
        raise Error("You do not have permission to perform this booking action.", 403)
    if user["role"] not in ("user", "admin"):
        raise Error("You do not have access to venue booking.", 403)


# Intervals are half-open, so consecutive bookings may share an endpoint.
# A pending booking holds its slot until it is decided or its start time passes.
OVERLAP = """
    start_at < ? AND end_at > ?
    AND (status = 'approved' OR (status = 'pending' AND start_at > ?))
"""


def listing(c, user, query, Error):
    allow(user, Error)
    current = now()
    if user["role"] == "admin":
        return {
            "pending": [
                dict(row)
                for row in c.execute(
                    """
                    SELECT b.id, v.name AS venue_name, b.start_at, b.end_at, b.purpose,
                           u.name AS requester_name, b.requester
                    FROM venue_bookings b
                    JOIN venues v ON v.id = b.venue_id
                    JOIN users u ON u.id = b.requester
                    WHERE b.status = 'pending' AND b.start_at > ?
                    ORDER BY b.start_at, b.created_at
                    """,
                    (current,),
                )
            ]
        }

    result = {
        "bookings": [
            dict(row)
            for row in c.execute(
                """
                SELECT b.id, v.name AS venue_name, b.start_at, b.end_at, b.purpose,
                       CASE WHEN b.status = 'pending' AND b.start_at <= ?
                            THEN 'expired' ELSE b.status END AS status,
                       b.decision, b.review_note, b.decided_at, b.read_at,
                       (b.status IN ('pending', 'approved') AND b.start_at > ?) AS can_cancel
                FROM venue_bookings b JOIN venues v ON v.id = b.venue_id
                WHERE b.requester = ?
                ORDER BY b.created_at DESC, b.id
                """,
                (current, current, user["id"]),
            )
        ]
    }
    if "start" in query or "end" in query:
        start, end = interval(
            query.get("start", [""])[0], query.get("end", [""])[0], Error
        )
        result["venues"] = [
            dict(row)
            for row in c.execute(
                f"""
                SELECT v.*, CASE
                    WHEN ? <= ? THEN 'past'
                    WHEN EXISTS (
                        SELECT 1 FROM venue_bookings b
                        WHERE b.venue_id = v.id AND {OVERLAP}
                    ) THEN 'held'
                    ELSE 'available'
                END AS availability
                FROM venues v ORDER BY v.id
                """,
                (start, current, end, start, current),
            )
        ]
    return result


def text_field(value, label, limit, Error, required=True):
    if isinstance(value, str):
        value = value.strip()
        if len(value) <= limit and (value or not required):
            return value
    if required and isinstance(value, str) and not value:
        raise Error(f"Enter {label}.")
    raise Error(f"The {label} is invalid or exceeds {limit} characters.")


def create(c, user, body, Error):
    start, end = interval(body.get("start"), body.get("end"), Error)
    venue = text_field(body.get("venue_id", ""), "venue", 40, Error)
    purpose = text_field(body.get("purpose", ""), "booking purpose", 200, Error)
    current = now()
    if start <= current:
        raise Error("The booking must start in the future.")
    if not c.execute("SELECT 1 FROM venues WHERE id = ?", (venue,)).fetchone():
        raise Error("The selected venue does not exist.", 404)
    if c.execute(
        f"SELECT 1 FROM venue_bookings WHERE venue_id = ? AND {OVERLAP} LIMIT 1",
        (venue, end, start, current),
    ).fetchone():
        raise Error(
            "The venue already has a booking or pending request during that time.",
            409,
        )
    booking_id = secrets.token_hex(12)
    c.execute(
        """
        INSERT INTO venue_bookings
            (id, venue_id, requester, start_at, end_at, purpose, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (booking_id, venue, user["id"], start, end, purpose, current),
    )
    return {"id": booking_id, "status": "pending"}


def change(c, user, action, body, Error):
    allow(user, Error, "admin" if action == "review" else "user")
    if action == "create":
        return create(c, user, body, Error)
    booking_id = text_field(body.get("id", ""), "booking ID", 24, Error)
    booking = c.execute(
        "SELECT * FROM venue_bookings WHERE id = ?", (booking_id,)
    ).fetchone()
    if not booking or (action != "review" and booking["requester"] != user["id"]):
        raise Error("The booking was not found.", 404)
    current = now()
    if action == "read":
        if not booking["decision"]:
            raise Error("The booking notification was not found.", 404)
        c.execute(
            "UPDATE venue_bookings SET read_at = COALESCE(read_at, ?) WHERE id = ?",
            (current, booking_id),
        )
    elif action == "cancel":
        if booking["status"] != "cancelled":
            if (
                booking["status"] not in ("pending", "approved")
                or booking["start_at"] <= current
            ):
                raise Error("This booking can no longer be canceled.", 409)
            c.execute(
                "UPDATE venue_bookings SET status = 'cancelled' WHERE id = ?",
                (booking_id,),
            )
    else:
        decision = body.get("decision")
        if decision not in ("approved", "rejected"):
            raise Error("Select Approve or Reject.")
        note = text_field(
            body.get("note", ""),
            "review note",
            300,
            Error,
            required=decision == "rejected",
        )
        if booking["status"] != "pending" or booking["start_at"] <= current:
            raise Error(
                "This request was already processed, canceled, or expired. Refresh the queue.",
                409,
            )
        c.execute(
            """
            UPDATE venue_bookings
            SET status = ?, decision = ?, reviewer = ?, review_note = ?, decided_at = ?
            WHERE id = ?
            """,
            (decision, decision, user["id"], note, current, booking_id),
        )
    return {"ok": True}
