-- Module 1 / Module 2 业务表。合并进主系统时执行本文件即可，
-- 不含 users / sessions（主系统已有，避免重复定义与冲突）。

CREATE TABLE IF NOT EXISTS kb_chunks(
    id TEXT PRIMARY KEY,
    doc_id TEXT, doc_title TEXT, doc_owner TEXT, doc_version TEXT, doc_updated TEXT,
    section TEXT, ordinal INTEGER, text TEXT
);

CREATE TABLE IF NOT EXISTS qa_logs(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT, question TEXT, mode TEXT, answered INTEGER DEFAULT 0,
    confidence REAL DEFAULT 0, top_score REAL DEFAULT 0,
    citations TEXT DEFAULT '[]', used_chunks TEXT DEFAULT '[]',
    latency_ms INTEGER DEFAULT 0, created TEXT,
    helpful INTEGER, note TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS risk_records(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT, term TEXT, course_code TEXT, course_name TEXT,
    assessment TEXT, weight REAL, due TEXT, submitted TEXT, score REAL,
    on_time INTEGER DEFAULT 0, synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS risk_activity(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT, day TEXT, logins INTEGER DEFAULT 0,
    qa_asks INTEGER DEFAULT 0,
    bookings INTEGER DEFAULT 0,   -- 预留给 Module 4，当前评分模型不使用
    synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS risk_snapshots(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT, created TEXT, score REAL, level TEXT,
    coverage REAL, factors TEXT, actions TEXT, synthetic INTEGER DEFAULT 1
);

-- 一条记录对应一个收件人。
-- kind = auto   ：系统达到阈值自动发送，同时写入学生与教师两条；
-- kind = manual ：教师手动留言，仅发给学生。
CREATE TABLE IF NOT EXISTS risk_notes(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT,
    recipient TEXT,
    recipient_role TEXT,
    kind TEXT DEFAULT 'manual',
    level TEXT, score REAL,
    author TEXT,
    title TEXT, body TEXT,
    created TEXT, read_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_risk_records_student ON risk_records(student_id);
CREATE INDEX IF NOT EXISTS idx_risk_activity_student ON risk_activity(student_id);
CREATE INDEX IF NOT EXISTS idx_risk_snapshots_student ON risk_snapshots(student_id);
CREATE INDEX IF NOT EXISTS idx_risk_notes_recipient ON risk_notes(recipient);
CREATE INDEX IF NOT EXISTS idx_qa_logs_created ON qa_logs(created);
