"""Module 2 单元测试：权重、等级、数据不足处理、权限。"""

import unittest

from tests import support

from core import db  # noqa: E402
from core.http import APIError, Ctx  # noqa: E402
from modules import risk_warning as rw  # noqa: E402


class ScoringTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        support.fresh_db()
        cls.conn = db.connect()

    @classmethod
    def tearDownClass(cls):
        cls.conn.close()

    def test_weights_sum_to_one(self):
        self.assertAlmostEqual(sum(f["weight"] for f in rw.FACTORS), 1.0, places=6)

    def test_weights_match_specification(self):
        """权重模型：作业提交 0.3、成绩趋势 0.3、登录次数 0.2、问答次数 0.2。"""
        weights = {f["key"]: f["weight"] for f in rw.FACTORS}
        self.assertEqual(
            set(weights), {"submission", "grade", "engagement", "participation"}
        )
        self.assertAlmostEqual(weights["submission"], 0.30)
        self.assertAlmostEqual(weights["grade"], 0.30)
        self.assertAlmostEqual(weights["engagement"], 0.20)
        self.assertAlmostEqual(weights["participation"], 0.20)

    def test_scores_within_bounds(self):
        for student_id, *_ in db.STUDENTS:
            with self.subTest(student=student_id):
                result = rw.assess(self.conn, student_id)
                self.assertGreaterEqual(result["score"], 0)
                self.assertLessEqual(result["score"], 100)
                self.assertIn(result["level"], ("high", "watch", "low", "unknown"))

    def test_contributions_add_up_to_score(self):
        """四项贡献之和必须等于总分，保证分数可手工复算。"""
        for student_id, *_ in db.STUDENTS:
            with self.subTest(student=student_id):
                result = rw.assess(self.conn, student_id)
                total = sum(f["contribution"] for f in result["factors"])
                self.assertAlmostEqual(total, result["score"], delta=0.6)

    def test_level_thresholds_match_policy(self):
        self.assertEqual(rw._level(60, 1.0)[0], "high")
        self.assertEqual(rw._level(35, 1.0)[0], "watch")
        self.assertEqual(rw._level(34.9, 1.0)[0], "low")
        self.assertEqual(rw._level(90, 0.3)[0], "unknown")

    def test_low_coverage_refuses_to_grade(self):
        """覆盖率低于 40% 时不给等级，避免用残缺数据下结论。"""
        self.assertEqual(rw._level(88, 0.35), ("unknown", "数据不足"))

    def test_stable_student_is_normal(self):
        result = rw.assess(self.conn, "s2023001")
        self.assertEqual(result["level"], "low")
        self.assertLess(result["score"], 35)

    def test_disengaged_student_is_flagged(self):
        result = rw.assess(self.conn, "s2023005")
        self.assertEqual(result["level"], "high")
        self.assertGreaterEqual(result["score"], 60)
        self.assertIn("作业", result["driver"])

    def test_good_grades_low_activity_is_watch_not_high(self):
        """成绩好但几乎不登录的学生只判关注，避免把单一信号当成结论。"""
        result = rw.assess(self.conn, "s2023011")
        self.assertIn(result["level"], ("watch", "low"))
        self.assertLess(result["score"], 60)

    def test_actions_are_derived_from_factors(self):
        result = rw.assess(self.conn, "s2023008")
        self.assertTrue(result["actions"])
        self.assertLessEqual(len(result["actions"]), 3)
        for action in result["actions"]:
            self.assertTrue(any(action in rw.ACTIONS[f["key"]] for f in result["factors"]))

    def test_snapshot_history_accumulates(self):
        for _ in range(2):
            rw.save(self.conn, rw.assess(self.conn, "s2023003"))
        self.conn.commit()
        rows = rw.history(self.conn, "s2023003", 5)
        self.assertGreaterEqual(len(rows), 2)
        self.assertLessEqual(rows[0]["created"], rows[-1]["created"])

    def test_missing_records_marked_insufficient(self):
        conn = db.connect()
        try:
            conn.execute("DELETE FROM risk_records WHERE student_id='s2023002'")
            result = rw.assess(conn, "s2023002")
            grade = next(f for f in result["factors"] if f["key"] == "grade")
            self.assertFalse(grade["sufficient"])
            self.assertIn("成绩趋势", result["missing"])
            self.assertLess(result["coverage"], 1.0)
        finally:
            conn.rollback()
            conn.close()


class AlertTest(unittest.TestCase):
    """自动预警：分数达到阈值时同时通知学生与学业导师。"""

    @classmethod
    def setUpClass(cls):
        support.fresh_db()
        cls.conn = db.connect()

    @classmethod
    def tearDownClass(cls):
        cls.conn.close()

    def setUp(self):
        self.conn.execute("DELETE FROM risk_notes")
        self.conn.commit()

    def notes(self, student_id):
        return self.conn.execute(
            "SELECT * FROM risk_notes WHERE student_id=? ORDER BY id", (student_id,)
        ).fetchall()

    def test_high_risk_alerts_student_and_teacher(self):
        result = rw.assess(self.conn, "s2023005")
        self.assertEqual(result["level"], "high")

        created = rw.alert_if_needed(self.conn, result)
        self.conn.commit()
        self.assertEqual(len(created), 2)

        rows = self.notes("s2023005")
        self.assertEqual({row["recipient_role"] for row in rows}, {"student", "teacher"})
        recipients = {row["recipient"] for row in rows}
        self.assertIn("s2023005", recipients)
        self.assertIn("teacher", recipients)
        self.assertTrue(all(row["kind"] == "auto" for row in rows))
        self.assertTrue(all(row["author"] == "system" for row in rows))
        self.assertTrue(all(row["score"] >= rw.AUTO_ALERT_SCORE for row in rows))

    def test_watch_level_does_not_alert(self):
        result = rw.assess(self.conn, "s2023004")
        self.assertEqual(result["level"], "watch")
        self.assertEqual(rw.alert_if_needed(self.conn, result), [])
        self.assertEqual(self.notes("s2023004"), [])

    def test_alert_is_throttled_by_cooldown(self):
        result = rw.assess(self.conn, "s2023008")
        self.assertEqual(len(rw.alert_if_needed(self.conn, result)), 2)
        self.conn.commit()
        self.assertEqual(rw.alert_if_needed(self.conn, result), [])
        self.assertEqual(len(self.notes("s2023008")), 2)

    def test_check_all_covers_every_student(self):
        fired = rw.check_all(self.conn)
        self.assertGreaterEqual(fired, 2)
        high = self.conn.execute(
            "SELECT count(DISTINCT student_id) FROM risk_notes WHERE kind='auto'"
        ).fetchone()[0]
        self.assertGreaterEqual(high, 1)

    def test_notification_visibility_is_per_recipient(self):
        result = rw.assess(self.conn, "s2023005")
        rw.alert_if_needed(self.conn, result)
        self.conn.commit()

        student_ctx = Ctx(self.conn, dict(
            self.conn.execute("SELECT * FROM users WHERE id='s2023005'").fetchone()
        ))
        teacher_ctx = Ctx(self.conn, dict(
            self.conn.execute("SELECT * FROM users WHERE id='teacher'").fetchone()
        ))
        other_ctx = Ctx(self.conn, dict(
            self.conn.execute("SELECT * FROM users WHERE id='s2023001'").fetchone()
        ))

        self.assertEqual(len(rw.notifications(student_ctx)["items"]), 1)
        self.assertEqual(len(rw.notifications(teacher_ctx)["items"]), 1)
        self.assertEqual(rw.notifications(other_ctx)["items"], [])

    def test_student_cannot_mark_others_note(self):
        result = rw.assess(self.conn, "s2023005")
        rw.alert_if_needed(self.conn, result)
        self.conn.commit()
        note_id = self.notes("s2023005")[0]["id"]

        other = Ctx(self.conn, dict(
            self.conn.execute("SELECT * FROM users WHERE id='s2023001'").fetchone()
        ))
        other.body = {"id": note_id}
        with self.assertRaises(APIError):
            rw.mark_read(other)


class AccessTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        support.fresh_db()
        cls.conn = db.connect()

    @classmethod
    def tearDownClass(cls):
        cls.conn.close()

    def ctx(self, user_id):
        user = dict(
            self.conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        )
        return Ctx(self.conn, user)

    def test_teacher_sees_only_own_students(self):
        data = rw.listing(self.ctx("teacher"))
        ids = {item["student_id"] for item in data["items"]}
        self.assertIn("s2023001", ids)
        self.assertNotIn("s2023009", ids)  # 属于另一位教师 teacher2
        self.assertEqual(len(ids), 8)

    def test_teacher_cannot_open_other_teachers_student(self):
        ctx = self.ctx("teacher")
        ctx.params = {"student_id": "s2023009"}
        with self.assertRaises(APIError) as error:
            rw.detail(ctx)
        self.assertEqual(error.exception.status, 403)

    def test_sysadmin_cannot_read_academic_risk(self):
        """系统管理员与教师是两类用户：后台角色不得查看学生成绩与预警。"""
        with self.assertRaises(APIError) as error:
            rw.listing(self.ctx("sysadmin"))
        self.assertEqual(error.exception.status, 403)

    def test_sysadmin_cannot_open_student_detail(self):
        ctx = self.ctx("sysadmin")
        ctx.params = {"student_id": "s2023001"}
        with self.assertRaises(APIError):
            rw.detail(ctx)

    def test_sysadmin_cannot_push_warning(self):
        ctx = self.ctx("sysadmin")
        ctx.body = {"student_id": "s2023005"}
        with self.assertRaises(APIError):
            rw.notify(ctx)

    def test_student_cannot_read_teacher_view(self):
        with self.assertRaises(APIError):
            rw.listing(self.ctx("s2023001"))

    def test_student_reads_own_profile(self):
        result = rw.me(self.ctx("s2023002"))
        self.assertEqual(result["student_id"], "s2023002")
        self.assertIn("factors", result)
        self.assertEqual(len(result["factors"]), 4)

    def test_student_cannot_read_other_profile(self):
        ctx = self.ctx("s2023001")
        ctx.params = {"student_id": "s2023002"}
        with self.assertRaises(APIError):
            rw.detail(ctx)

    def test_teacher_cannot_use_student_self_view(self):
        with self.assertRaises(APIError):
            rw.me(self.ctx("teacher"))

    def test_notify_rejects_other_teachers_student(self):
        ctx = self.ctx("teacher")
        ctx.body = {"student_id": "s2023009"}
        with self.assertRaises(APIError):
            rw.notify(ctx)

    def test_identities_are_distinct(self):
        """五类身份都在库里独立存在，教师与系统管理员不是同一个账号。"""
        rows = self.conn.execute(
            "SELECT DISTINCT identity FROM users ORDER BY identity"
        ).fetchall()
        identities = {row["identity"] for row in rows}
        self.assertIn("学生", identities)
        self.assertIn("教师", identities)
        self.assertIn("系统管理员", identities)
        teacher = self.conn.execute(
            "SELECT role,identity FROM users WHERE id='teacher'"
        ).fetchone()
        sysadmin = self.conn.execute(
            "SELECT role,identity,name FROM users WHERE id='sysadmin'"
        ).fetchone()
        self.assertEqual(teacher["identity"], "教师")
        self.assertEqual(sysadmin["identity"], "系统管理员")
        self.assertEqual(sysadmin["name"], "系统管理员")


if __name__ == "__main__":
    unittest.main()
