"""数据库层：建表、种子用户、合成学业数据。

设计说明（可写入报告）：
- 本项目为课程原型，GCU 为虚构学校，不存在真实学生数据。
- M2 学业预警所需的成绩、作业提交、登录与预约记录全部由本文件的
  ``seed_academic()`` 按固定随机种子合成，并在库中统一带 ``synthetic`` 标记。
- 合并进主系统时，只需保留表结构与查询逻辑，把合成数据替换为教务系统导入。
"""

import hashlib
import os
import random
import secrets
import sqlite3
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(
    os.environ.get("CAMPUSCARE_LEARNING_DB", str(ROOT / "data" / "learning.sqlite3"))
)

DEMO_PASSWORD = "Campus2026!"
SCHEMA_VERSION = 3


class _Connection(sqlite3.Connection):
    """sqlite3 的 `with conn:` 只提交事务、不关闭连接。

    Windows 上未关闭的连接会一直锁住数据库文件（测试里重建库时直接 PermissionError），
    因此这里让上下文退出时同时提交并关闭。
    """

    def __exit__(self, exc_type, exc_value, traceback):
        try:
            super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()
        return False


def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), timeout=15, factory=_Connection)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def digest(password, salt):
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode(), bytes.fromhex(salt), 120000
    ).hex()


def now_iso():
    return datetime.now().isoformat(timespec="seconds")


SCHEMA = """
CREATE TABLE IF NOT EXISTS users(
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,              -- user / admin
    identity TEXT NOT NULL,          -- 学生 / 教师 / 校园管理人员
    student_no TEXT DEFAULT '',
    program TEXT DEFAULT '',
    advisor TEXT DEFAULT '',
    salt TEXT NOT NULL,
    password TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    created TEXT
);

CREATE TABLE IF NOT EXISTS sessions(
    token TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    expires TEXT,
    csrf TEXT
);

-- M1 知识库分块
CREATE TABLE IF NOT EXISTS kb_chunks(
    id TEXT PRIMARY KEY,
    doc_id TEXT, doc_title TEXT, doc_owner TEXT, doc_version TEXT, doc_updated TEXT,
    section TEXT, ordinal INTEGER, text TEXT
);

-- M1 问答日志：既做审计，也做"知识缺口"分析的输入
CREATE TABLE IF NOT EXISTS qa_logs(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT, question TEXT, mode TEXT, answered INTEGER DEFAULT 0,
    confidence REAL DEFAULT 0, top_score REAL DEFAULT 0,
    citations TEXT DEFAULT '[]', used_chunks TEXT DEFAULT '[]',
    latency_ms INTEGER DEFAULT 0, created TEXT,
    helpful INTEGER, note TEXT DEFAULT ''
);

-- M2 合成学业记录
CREATE TABLE IF NOT EXISTS risk_records(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT, term TEXT, course_code TEXT, course_name TEXT,
    assessment TEXT, weight REAL, due TEXT, submitted TEXT, score REAL,
    on_time INTEGER DEFAULT 0, synthetic INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS risk_activity(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT, day TEXT, logins INTEGER DEFAULT 0,
    -- bookings 预留给 Module 4 的场地预约统计，当前评分模型不使用
    qa_asks INTEGER DEFAULT 0, bookings INTEGER DEFAULT 0, synthetic INTEGER DEFAULT 1
);

-- M2 每次扫描的结果快照，用于展示分数变化
CREATE TABLE IF NOT EXISTS risk_snapshots(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT, created TEXT, score REAL, level TEXT,
    coverage REAL, factors TEXT, actions TEXT, synthetic INTEGER DEFAULT 1
);

-- M2 预警通知（站内消息）：一条记录一个收件人。
-- kind = auto 表示系统按阈值自动发出（同时发给学生与教师），manual 表示教师手动留言。
CREATE TABLE IF NOT EXISTS risk_notes(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT,            -- 被评估的学生（通知的主体）
    recipient TEXT,             -- 收件人 user id
    recipient_role TEXT,        -- student / teacher
    kind TEXT DEFAULT 'manual', -- auto / manual
    level TEXT, score REAL,
    author TEXT,                -- 触发人：system 或教师 id
    title TEXT, body TEXT,
    created TEXT, read_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_risk_records_student ON risk_records(student_id);
CREATE INDEX IF NOT EXISTS idx_risk_activity_student ON risk_activity(student_id);
CREATE INDEX IF NOT EXISTS idx_risk_snapshots_student ON risk_snapshots(student_id);
CREATE INDEX IF NOT EXISTS idx_risk_notes_recipient ON risk_notes(recipient);
CREATE INDEX IF NOT EXISTS idx_qa_logs_created ON qa_logs(created);
"""


def _migrate(conn):
    """旧库增量升级：早期 risk_notes 只存"发给学生"的留言，缺少收件人字段。"""
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(risk_notes)")}
    for name, ddl in [
        ("recipient", "ALTER TABLE risk_notes ADD COLUMN recipient TEXT"),
        ("recipient_role", "ALTER TABLE risk_notes ADD COLUMN recipient_role TEXT"),
        ("kind", "ALTER TABLE risk_notes ADD COLUMN kind TEXT DEFAULT 'manual'"),
        ("score", "ALTER TABLE risk_notes ADD COLUMN score REAL"),
    ]:
        if name not in columns:
            conn.execute(ddl)
    conn.execute(
        "UPDATE risk_notes SET recipient=student_id, recipient_role='student', kind='manual' "
        "WHERE recipient IS NULL"
    )

# 五类用户，彼此独立、不合并（子系统的可见范围靠 identity 区分）：
#   学生       —— 学习支持的使用者
#   教师       —— 学业预警的责任人（学业导师）
#   行政人员   —— 场地与证明审批（属于 Module 4 / 5，不在本分支）
#   维修人员   —— 设施维修（属于 Module 3，不在本分支）
#   系统管理员 —— 账号、知识库语料、系统日志与配置
IDENTITIES = ("学生", "教师", "行政人员", "维修人员", "系统管理员")

# 演示账号：id, 姓名, 角色, 身份, 学号/工号, 所属, 导师
STAFF = [
    ("sysadmin", "系统管理员", "admin", "系统管理员", "GCU-SYS-0001", "信息技术服务处", ""),
    ("teacher", "王老师", "user", "教师", "GCU-STAFF-0142", "计算机学院", ""),
    ("teacher2", "李老师", "user", "教师", "GCU-STAFF-0187", "计算机学院", ""),
]

# 学生画像：id, 姓名, 专业, 类型, 导师
# 类型决定合成数据的形态，确保演示时能看到从正常到高风险的完整分布。
STUDENTS = [
    ("s2023001", "王明", "计算机科学", "stable", "teacher"),
    ("s2023002", "李强", "软件工程", "stable", "teacher"),
    ("s2023003", "张伟", "数据科学", "slip", "teacher"),
    ("s2023004", "刘洋", "计算机科学", "watch", "teacher"),
    ("s2023005", "陈杰", "软件工程", "high", "teacher"),
    ("s2023006", "杨帆", "数据科学", "stable", "teacher"),
    ("s2023007", "赵磊", "计算机科学", "watch", "teacher"),
    ("s2023008", "孙浩", "软件工程", "high", "teacher"),
    ("s2023009", "周涛", "数据科学", "stable", "teacher2"),
    ("s2023010", "吴敏", "计算机科学", "watch", "teacher2"),
    ("s2023011", "郑凯", "软件工程", "isolated", "teacher2"),
    ("s2023012", "冯宇", "数据科学", "watch", "teacher2"),
]

COURSES = [
    ("CSIT121", "面向对象程序设计", 6),
    ("CSIT883", "系统分析与项目管理", 6),
    ("STAT201", "概率与统计", 6),
]

ASSESSMENTS = [
    ("作业一", 0.10, 7),
    ("作业二", 0.10, 21),
    ("阶段测验", 0.20, 35),
    ("作业三", 0.10, 49),
    ("期末模拟", 0.10, 56),
]

# 画像参数：提交率、基准分、成绩漂移、日均登录、双周问答、双周预约
PROFILES = {
    "stable": dict(submit=0.96, base=78, drift=1.5, login=1.5, qa=3.0, booking=2.0),
    "watch": dict(submit=0.72, base=66, drift=-9.0, login=0.6, qa=0.8, booking=0.5),
    "slip": dict(submit=0.62, base=64, drift=-13.0, login=0.55, qa=0.4, booking=0.4),
    "high": dict(submit=0.38, base=55, drift=-19.0, login=0.18, qa=0.0, booking=0.1),
    # 只缺活跃度：用来演示"单一因子只出初级提示"，避免误报高风险的例子
    "isolated": dict(submit=0.95, base=82, drift=0.5, login=0.15, qa=0.2, booking=0.0),
}


def init():
    with connect() as conn:
        conn.executescript(SCHEMA)
        _migrate(conn)
        _seed_users(conn)
        _seed_academic(conn)
        conn.commit()


def _seed_users(conn):
    if conn.execute("SELECT count(*) FROM users").fetchone()[0]:
        return
    rows = []
    for uid, name, role, identity, no, program, advisor in STAFF + [
        (sid, sname, "user", "学生", sid.upper(), program, adv)
        for sid, sname, program, _profile, adv in STUDENTS
    ]:
        salt = secrets.token_hex(16)
        rows.append(
            (
                uid,
                name,
                role,
                identity,
                no,
                program,
                advisor,
                salt,
                digest(DEMO_PASSWORD, salt),
                now_iso(),
            )
        )
    conn.executemany(
        "INSERT INTO users(id,name,role,identity,student_no,program,advisor,salt,password,created)"
        " VALUES(?,?,?,?,?,?,?,?,?,?)",
        rows,
    )


def _seed_academic(conn):
    """按固定种子生成 12 名学生、近 8 周的学业与活跃记录。"""
    if conn.execute("SELECT count(*) FROM risk_records").fetchone()[0]:
        return

    rng = random.Random(20260216)
    today = date.today()
    term = "2026-S1"

    records, activity = [], []
    for sid, _name, _program, profile, _advisor in STUDENTS:
        p = PROFILES[profile]

        # --- 考核记录：每门课 5 次考核 ---
        for code, cname, _cp in COURSES:
            for idx, (aname, weight, day_offset) in enumerate(ASSESSMENTS):
                due = today - timedelta(days=56 - day_offset)
                submitted, on_time = None, 0
                roll = rng.random()
                if roll < p["submit"]:
                    submitted = (due - timedelta(days=rng.randint(0, 2))).isoformat()
                    on_time = 1
                elif roll < p["submit"] + 0.15:
                    submitted = (due + timedelta(days=rng.randint(1, 5))).isoformat()
                score = None
                if submitted:
                    base = p["base"] + p["drift"] * (idx / (len(ASSESSMENTS) - 1))
                    score = max(28.0, min(97.0, base + rng.uniform(-6, 6)))
                    if not on_time:
                        score = max(20.0, score - 4)
                records.append(
                    (
                        sid,
                        term,
                        code,
                        cname,
                        aname,
                        weight,
                        due.isoformat(),
                        submitted,
                        None if score is None else round(score, 1),
                        on_time,
                    )
                )

        # --- 近 28 天活跃记录（登录 / 问答 / 场馆预约） ---
        days = [today - timedelta(days=back) for back in range(28)]
        logins_per_day = []
        for day in days:
            lam = p["login"] * (0.45 if day.weekday() >= 5 else 1.0)
            n = 1 if rng.random() < min(0.95, lam) else 0
            if lam > 1.2 and rng.random() < 0.45:
                n += 1
            logins_per_day.append(n)

        # 求助与预约按画像给定的双周频次摊到 28 天，保持整数且可复现
        qa_budget = int(round(p["qa"] * 2))
        book_budget = int(round(p["booking"] * 2))
        qa_days = sorted(rng.sample(range(28), min(qa_budget, 28))) if qa_budget else []
        book_days = (
            sorted(rng.sample(range(28), min(book_budget, 28))) if book_budget else []
        )

        for i, day in enumerate(days):
            activity.append(
                (
                    sid,
                    day.isoformat(),
                    logins_per_day[i],
                    1 if i in qa_days else 0,
                    1 if i in book_days else 0,
                )
            )

    conn.executemany(
        "INSERT INTO risk_records(student_id,term,course_code,course_name,assessment,weight,due,submitted,score,on_time)"
        " VALUES(?,?,?,?,?,?,?,?,?,?)",
        records,
    )
    conn.executemany(
        "INSERT INTO risk_activity(student_id,day,logins,qa_asks,bookings) VALUES(?,?,?,?,?)",
        activity,
    )


def reset():
    """清空并重建（测试与演示复用）。"""
    if DB_PATH.exists():
        DB_PATH.unlink()
    init()