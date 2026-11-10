"""Translate built-in labels from existing databases; preserve user-authored content."""

import json
import re

IDENTITIES = {
    "学生": "Student",
    "教师": "Faculty",
    "维修人员": "Technician",
    "校园管理人员": "Administrator",
}

CATEGORIES = {
    "空调": "Air Conditioner",
    "风扇": "Fan",
    "灯具": "Light Fixture",
    "路灯": "Streetlight",
    "电脑": "Computer",
    "投影仪": "Projector",
    "家具": "Furniture",
    "门锁": "Door Lock",
    "水务": "Plumbing",
    "洗衣机": "Washing Machine",
    "饮水机": "Water Dispenser",
    "围栏": "Fence",
    "路面": "Road Surface",
}

DEMO_NAMES = {
    "演示学生": "Demo Student",
    "演示教师": "Demo Faculty",
    "电工维修员": "Electrical Technician",
    "水务维修员": "Plumbing Technician",
    "IT 维修员": "IT Technician",
    "校园管理员": "Campus Administrator",
}

DEMO_SPECIALTIES = {
    "电工": "Electrical",
    "水务": "Plumbing",
}

LOCATIONS = {
    "明理楼 A": "Academic Building A",
    "知行楼 B": "Academic Building B",
    "栖园宿舍 D1": "Residence D1",
    "栖园宿舍 D2": "Residence D2",
    "维修服务中心": "Maintenance Center",
    "梧桐大道": "Sycamore Avenue",
    "明理路": "Academic Way",
    "栖园路": "Residence Road",
}

LOCATION_DETAILS = {
    "后勤维修服务点": "Campus maintenance services",
    "校门至教学区主干道": "Main road from the campus gate to the academic buildings",
    "教学区道路": "Academic precinct road",
    "宿舍区道路": "Residence precinct road",
}

ASSET_NAMES = {
    "空调": "Air Conditioner",
    "吊扇": "Ceiling Fan",
    "教室照明": "Classroom Lighting",
    "教师电脑": "Instructor Workstation",
    "投影仪": "Projector",
    "课桌": "Student Desk",
    "宿舍门锁": "Residence Door Lock",
    "床架": "Bed Frame",
    "宿舍照明": "Residence Lighting",
    "水龙头": "Faucet",
    "公共洗衣机": "Shared Washing Machine",
    "公共饮水机": "Shared Water Dispenser",
    "道路照明": "Road Lighting",
    "公共长椅": "Campus Bench",
    "围栏": "Fence",
    "路面": "Road Surface",
}

ASSET_POSITIONS = {
    "教室内": "Inside the classroom",
    "宿舍内": "Inside the residence room",
    "道路公共区域": "Public roadside area",
}

DEMO_TITLES = {
    "空调运行后持续滴水": "Air conditioner leaking during operation",
    "夜间第三盏路灯不亮": "Streetlight 3 not working at night",
    "公共洗衣机脱水时异响": "Unusual noise during the washing machine spin cycle",
    "教师电脑无法联网": "Instructor workstation cannot connect to the internet",
    "水龙头关闭后仍滴水": "Faucet drips after being turned off",
    "长椅座板松动": "Loose bench seat slat",
    "历史维护记录": "Historical Maintenance Record",
}

DEMO_DESCRIPTIONS = {
    "空调开启二十分钟后滴水，尚不清楚具体原因。": "The air conditioner starts dripping after 20 minutes. The cause is unknown.",
    "昨晚其他灯亮着，这盏没有亮。": "Nearby lights were working last night, but this one was off.",
    "洗衣机脱水时声音很大，暂时停止使用。": "The washer makes a loud noise during the spin cycle. It has been taken out of use.",
    "电脑能正常开机，但浏览器无法打开网页。": "The computer starts normally, but the browser cannot load webpages.",
    "关闭后仍持续滴水，水流较小。": "The faucet continues to drip after being turned off.",
    "长椅一侧座板松动，建议检查。": "A seat slat is loose on one side of the bench. An inspection is recommended.",
    "模拟历史报修，用于维护提醒演示。": "Simulated work order used to demonstrate maintenance reminders.",
}

DEMO_RESULTS = {
    "检查网线接口并恢复连接，等待验收。": "Checked the Ethernet connection and restored access. Awaiting verification.",
    "完成检查与维修；模拟验收完成。": "Inspection and repair complete. Demo completion verified.",
}

GENERATED_NOTES = {
    "课程演示种子记录；并非真实校园故障。": "Demo record. This does not represent a real campus incident.",
    "用户确认提交；设施位置来自台账。": "Report submitted with the asset’s registered location confirmed by the reporter.",
    "管理员确认并派单": "Reviewed and assigned by an administrator.",
    "验收通过": "Completion verified.",
}

ASSIGNMENT_NOTES = {
    "原经办人已不可办理，已重新领取。": "Application reclaimed because the previous reviewer is unavailable.",
    "已领取申请。": "Application claimed.",
    "已交回待领取队列。": "Application returned to the unassigned queue.",
}

def identity(value):
    return IDENTITIES.get(value, value) if isinstance(value, str) else value


def category(value):
    return CATEGORIES.get(value, value)


def migrate(c):
    # All SQL targets are fixed; values are exact matches to old system defaults.
    fields = (
        ("users", "identity", IDENTITIES, "1"),
        ("users", "name", DEMO_NAMES, "created_at IS NULL AND id IN ('student','teacher','tech','plumber','it','admin')"),
        ("users", "skill", DEMO_SPECIALTIES, "created_at IS NULL AND id IN ('tech','plumber','it')"),
        ("users", "class_name", {"CSIT883 演示班": "CSIT883 Demo Class"}, "id='student' AND created_at IS NULL"),
        ("users", "department", {"计算机学院": "School of Computing"}, "id='student' AND created_at IS NULL"),
        ("locations", "name", LOCATIONS, "1"),
        ("locations", "description", {**LOCATION_DETAILS, "201–206 · 公共洗衣区": "201–206 · shared laundry"}, "1"),
        ("assets", "category", CATEGORIES, "1"),
        ("tickets", "title", DEMO_TITLES, "synthetic=1"),
        ("tickets", "description", DEMO_DESCRIPTIONS, "synthetic=1"),
        ("tickets", "result", DEMO_RESULTS, "synthetic=1"),
        ("events", "note", GENERATED_NOTES, "action IN ('seed','created','assign','accept')"),
        ("inspections", "note", {"维护复查": "Maintenance follow-up"}, "1"),
    )
    for table, field, replacements, condition in fields:
        c.executemany(
            f"UPDATE {table} SET {field}=? WHERE {field}=? AND ({condition})",
            ((new, old) for old, new in replacements.items()),
        )
    seed_asset = re.compile(
        r"(?:[AB]-(?:101|201|202)-(?:AC|FAN|LIGHT|PC|PROJ|DESK)-01"
        r"|D[12]-20[1-6]-(?:LOCK|BED|LIGHT|TAP)-01"
        r"|D[12]-PUBLIC-(?:WASH|WATER)-0[12]"
        r"|R[123]-(?:LIGHT-0[1-6]|(?:BENCH|FENCE|PATH)-01))"
    )
    positions = {
        **ASSET_POSITIONS,
        **{f"沿道路第 {n} 盏": f"Light {n} along the road" for n in range(1, 7)},
        **{f"一楼公共区 · {n}号": f"Ground floor common area · Unit {n}" for n in range(1, 3)},
    }
    for asset_id, name, position in c.execute("SELECT id,name,position FROM assets").fetchall():
        if not seed_asset.fullmatch(asset_id):
            continue
        new_name = ASSET_NAMES.get(name, name)
        new_position = positions.get(position, position)
        if (new_name, new_position) != (name, position):
            c.execute("UPDATE assets SET name=?,position=? WHERE id=?", (new_name, new_position, asset_id))

    # The generated first line of an assignment event is separate from the
    # reviewer's own note. Keep the note exactly as it was entered.
    for event_id, note in c.execute(
        "SELECT id,note FROM admin_service_events WHERE action IN ('claimed','released','transferred')"
    ).fetchall():
        headline, separator, comment = note.partition("\n")
        translated = ASSIGNMENT_NOTES.get(headline)
        if translated is None:
            match = re.fullmatch(r"已转交给 (.+)（([a-z0-9_]+)）。", headline)
            if match:
                translated = f"Reassigned to {DEMO_NAMES.get(match[1], match[1])} ({match[2]})."
        if translated is not None:
            c.execute("UPDATE admin_service_events SET note=? WHERE id=?", (translated + separator + comment, event_id))

    defaults = {"name": ("演示学生", "Demo Student"), "class_name": ("CSIT883 演示班", "CSIT883 Demo Class"),
                "department": ("计算机学院", "School of Computing")}
    for application_id, snapshot in c.execute(
        "SELECT id,profile FROM admin_service_applications WHERE applicant_id='student'"
    ).fetchall():
        profile = json.loads(snapshot)
        updates = {key: new for key, (old, new) in defaults.items() if profile.get(key) == old}
        if updates:
            profile.update(updates)
            c.execute("UPDATE admin_service_applications SET profile=? WHERE id=?",
                      (json.dumps(profile, ensure_ascii=False), application_id))
