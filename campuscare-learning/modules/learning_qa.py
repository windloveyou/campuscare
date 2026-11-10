"""Module 1 · Intelligent Q&A Assistant（智能问答助手）

流程：问题 → 检索（BM25）→ 判断证据是否足够 → 组织答案（生成或抽取）→ 标注出处 → 记日志。
两条回答路径：
  - model      : 配置了本地 Ollama 时，用检索到的片段约束生成，要求逐句标注 [n]；
  - extractive : 未配置或调用失败时，直接引用原文句子，不生成任何新内容。
任何一条路径都不会在检索不到证据时强行作答（见 MIN_SCORE 守卫）。
"""

import json
import os
import re
import time
import urllib.error
import urllib.request

from core.http import APIError, FileResponse, clamp

from . import docx_export, knowledge

MIN_SCORE = 4.0  # BM25 证据门槛：低于此分视为"知识库没有依据"
ANSWER_BUDGET = 420  # 抽取式答案的字数上限

SUGGESTIONS = [
    "作业晚交几天会扣多少分？",
    "期末不及格能不能补考？",
    "开学后第几周还能退课？",
    "申请休学最长可以多久？",
    "忘记统一认证密码怎么办？",
    "教室和体育场地要提前多久预约？",
    "学业预警有几级，分别会怎样？",
    "图书馆一次能借几本书？",
]

DISCLAIMER = (
    "答案由校园知识库检索生成，末尾编号对应原文出处，请以学校正式文件为准。"
)


def _sentences(text):
    parts = re.split(r"(?<=[。！？；])", text)
    return [p.strip() for p in parts if p.strip()]


def _pick_sentences(text, query_tokens, budget=ANSWER_BUDGET):
    """按与问题的词项重叠度挑句子，保持原文顺序，拼成不超过 budget 的答案。"""
    sentences = _sentences(text)
    if not sentences:
        return text[:budget]
    scored = []
    for i, sentence in enumerate(sentences):
        overlap = len(
            {t for t in knowledge.tokenize(sentence) if t in set(query_tokens)}
        )
        # 句子越靠前越可能是主题句，给一点基础分
        scored.append((overlap + (0.8 if i == 0 else 0), i))
    scored.sort(key=lambda pair: (-pair[0], pair[1]))

    chosen, total = [], 0
    for _score, i in scored:
        if total + len(sentences[i]) > budget and chosen:
            break
        chosen.append(i)
        total += len(sentences[i])
        if len(chosen) >= 4:
            break
    return "".join(sentences[i] for i in sorted(chosen))


def _citation(chunk, number):
    return {
        "n": number,
        "chunk_id": chunk["id"],
        "doc_id": chunk["doc_id"],
        "doc_title": chunk["doc_title"],
        "section": chunk["section"],
        "owner": chunk["doc_owner"],
        "updated": chunk["doc_updated"],
        "score": chunk["score"],
        "snippet": re.sub(r"\s+", " ", chunk["text"])[:240],
    }


def _extractive(question, hits, max_docs=3):
    """抽取式回答：只用原文句子，编号与实际引用严格对应。

    复杂问题往往横跨多份文件（例如"挂科会不会被学业预警"同时涉及考核办法与预警办法），
    因此按文件分组取每份文件的最高段落，最多引用三份不同文件；
    同一文件的次要段落不重复引用，避免把整篇文档都塞进答案。
    """
    tokens = set(knowledge.tokenize(question))
    top = hits[0]

    picked = [(0, top)]
    documents = {top["doc_id"]}
    for index, hit in enumerate(hits[1:], start=1):
        if len(picked) >= max_docs:
            break
        if hit["doc_id"] in documents:
            continue
        if hit["score"] < top["score"] * 0.5:
            continue
        picked.append((index, hit))
        documents.add(hit["doc_id"])

    blocks = []
    for position, (index, hit) in enumerate(picked):
        budget = ANSWER_BUDGET if position == 0 else 220
        body = _pick_sentences(hit["text"], tokens, budget=budget)
        lead = "根据" if position == 0 else "相关规定另见"
        blocks.append((f"{lead}《{hit['doc_title']}》{hit['section']}：\n\n{body}", index))

    parts, used = [], []
    for number, (block, hit_index) in enumerate(blocks, start=1):
        parts.append(f"{block} [{number}]")
        used.append(hit_index)
    return "\n\n".join(parts), used


def _context_block(hits):
    lines = []
    for i, hit in enumerate(hits[:4], start=1):
        text = re.sub(r"\s+", " ", hit["text"])[:600]
        lines.append(f"[{i}]《{hit['doc_title']}》{hit['section']}\n{text}")
    return "\n\n".join(lines)


PROMPT = """你是 GlobalConnect University 的学业事务助手。
规则：
1. 只能使用【资料】中的内容作答，不得使用资料以外的知识；
2. 不得编造条款编号、日期、金额或审批部门；
3. 先给结论，再给必要步骤，用中文，不超过 160 字；
4. 每个结论后面用 [编号] 标注依据，编号必须来自【资料】；
5. 如果资料不足以回答，只输出 INSUFFICIENT，不要解释。"""


def _ollama(question, hits):
    endpoint = os.environ.get("CAMPUSCARE_OLLAMA_URL", "").rstrip("/")
    if not endpoint:
        return None
    payload = {
        "model": os.environ.get("CAMPUSCARE_MODEL", "qwen2.5:7b"),
        "stream": False,
        "messages": [
            {"role": "system", "content": PROMPT},
            {
                "role": "user",
                "content": f"【资料】\n{_context_block(hits)}\n\n【问题】{question}",
            },
        ],
        "options": {"temperature": 0.1, "num_predict": 320},
    }
    request = urllib.request.Request(
        endpoint + "/api/chat",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            data = json.load(response)
        text = (data.get("message") or {}).get("content", "").strip()
    except (
        urllib.error.URLError,
        TimeoutError,
        OSError,
        ValueError,
        KeyError,
        AttributeError,
    ):
        return None
    if not text or "INSUFFICIENT" in text[:40]:
        return None
    return text[:900]


def _confidence(hits):
    top = hits[0]["score"]
    second = hits[1]["score"] if len(hits) > 1 else 0.0
    margin = (top - second) / max(top, 1e-6)
    value = 0.35 + 0.45 * (top / (top + 8)) + 0.2 * margin
    return round(clamp(value, 0, 0.97), 2)


def _label(value):
    return "较高" if value >= 0.72 else "中等" if value >= 0.52 else "偏低"


def _topics(hits, limit=3):
    seen, out = set(), []
    for hit in hits:
        key = (hit["doc_title"], hit["section"])
        if key in seen:
            continue
        seen.add(key)
        out.append({"doc_title": hit["doc_title"], "section": hit["section"]})
        if len(out) >= limit:
            break
    return out


def _followups(hits, used_indexes, limit=3):
    """给出 2–3 个"还想问"的切入点：本次没有引用、但检索命中的其他章节。"""
    used = {f"{hits[i]['doc_id']}|{hits[i]['section']}" for i in used_indexes}
    out, seen = [], set()
    for hit in hits:
        key = f"{hit['doc_id']}|{hit['section']}"
        if key in used or key in seen:
            continue
        seen.add(key)
        title = re.sub(r"^\d+(\.\d+)*\.?\s*", "", hit["section"]).strip()
        out.append(
            {
                "doc_title": hit["doc_title"],
                "section": hit["section"],
                "question": f"{title}是怎么规定的？",
            }
        )
        if len(out) >= limit:
            break
    return out


def _rerank(hits):
    """同一文档内两个段落分数几乎相同（差 <5%）时，优先呈现章节更靠前的段落。

    例："我想申请奖学金" 会同时命中「申请时间与材料」和「违规处理」，两者词频
    接近，后者显然不是学生第一个想看的答案；而"挂科了怎么办"命中的「补考与重修」
    分数明显更高，不受此规则影响。
    """
    if len(hits) < 2:
        return hits
    first, second = hits[0], hits[1]
    if (
        first["doc_id"] == second["doc_id"]
        and second["score"] >= first["score"] * 0.95
        and second["section_no"] < first["section_no"]
    ):
        hits = [second, first] + hits[2:]
    return hits


def answer(question):
    """核心问答：返回可直接渲染的完整结构，不写数据库。"""
    started = time.perf_counter()
    hits = _rerank(knowledge.get_index().search(question, limit=6))
    latency = round(max(0.1, (time.perf_counter() - started) * 1000), 1)
    top = hits[0] if hits else {"score": 0.0}

    if not hits or top["score"] < MIN_SCORE:
        return {
            "answer": (
                "知识库里没有检索到可以直接回答这个问题的依据。\n\n"
                "为了避免给出不准确的答复，系统不作推测。"
                "你可以换一种说法，或联系学业导师确认。"
            ),
            "mode": "guardrail",
            "mode_label": "未作答 · 证据不足",
            "answered": False,
            "guardrail": {
                "reason": f"最高相关度为 {top['score']:.1f}，低于证据门槛 {MIN_SCORE}",
                "topics": _topics(hits),
            },
            "confidence": 0.0,
            "confidence_label": "不足",
            "citations": [],
            "followups": [],
            "retrieval": [
                {
                    "doc_title": h["doc_title"],
                    "section": h["section"],
                    "score": h["score"],
                    "matched": h["matched"],
                }
                for h in hits
            ],
            "latency_ms": latency,
        }

    confidence = _confidence(hits)
    generated = _ollama(question, hits)
    if generated:
        text, mode, mode_label = generated, "model", "检索增强生成 · 本地模型"
        used = [int(n) - 1 for n in re.findall(r"\[(\d)\]", text)]
        used = [i for i in used if 0 <= i < len(hits)]
        if not used:  # 模型漏标出处：补上实际检索到的证据，而不是假装它标注了
            text += "\n\n资料来源 [1]"
            mode_label += "（出处由系统补充）"
            used = [0]
        used = sorted(set(used))
        citations = [
            _citation(hits[index], number + 1)
            for number, index in enumerate(used)
        ]
    else:
        text, used = _extractive(question, hits)
        mode = "extractive"
        mode_label = (
            "检索抽取 · 逐句引用原文"
            if not os.environ.get("CAMPUSCARE_OLLAMA_URL")
            else "检索抽取 · 生成模型不可用已降级"
        )
        citations = [
            _citation(hits[index], number + 1)
            for number, index in enumerate(used)
        ]

    return {
        "answer": text,
        "mode": mode,
        "mode_label": mode_label,
        "answered": True,
        "guardrail": None,
        "confidence": confidence,
        "confidence_label": _label(confidence),
        "citations": citations,
        "followups": _followups(hits, used),
        "retrieval": [
            {
                "doc_title": h["doc_title"],
                "section": h["section"],
                "score": h["score"],
                "matched": h["matched"],
            }
            for h in hits
        ],
        "latency_ms": latency,
    }


def _log(conn, user, question, result):
    cur = conn.execute(
        "INSERT INTO qa_logs(user_id,question,mode,answered,confidence,top_score,"
        "citations,used_chunks,latency_ms,created) VALUES(?,?,?,?,?,?,?,?,?,datetime('now','localtime'))",
        (
            user["id"] if user else None,
            question,
            result["mode"],
            1 if result["answered"] else 0,
            result["confidence"],
            (result["retrieval"][0]["score"] if result["retrieval"] else 0),
            json.dumps(result["citations"], ensure_ascii=False),
            json.dumps([c["chunk_id"] for c in result["citations"]]),
            result["latency_ms"],
        ),
    )
    return cur.lastrowid


def bump_activity(conn, user_id):
    """M1 → M2 的数据联动：提问行为计入"求助参与"因子。"""
    conn.execute(
        "UPDATE risk_activity SET qa_asks=qa_asks+1 "
        "WHERE student_id=? AND day=date('now','localtime')",
        (user_id,),
    )
    if conn.execute("SELECT changes()").fetchone()[0] == 0:
        conn.execute(
            "INSERT INTO risk_activity(student_id,day,logins,qa_asks,bookings) "
            "VALUES(?,date('now','localtime'),0,1,0)",
            (user_id,),
        )


# ---------------------------------------------------------------- HTTP 路由


def ask(ctx):
    question = ctx.need("question", "请输入你的问题", 300)
    if len(question) < 4:
        raise APIError("问题太短，请补充具体事项，例如「作业晚交怎么扣分」")

    result = answer(question)
    result["log_id"] = _log(ctx.conn, ctx.user, question, result)
    if result["answered"] and ctx.user["identity"] == "学生":
        bump_activity(ctx.conn, ctx.user["id"])
    ctx.conn.commit()
    result["question"] = question
    result["disclaimer"] = DISCLAIMER
    return result


def feedback(ctx):
    log_id = ctx.body.get("log_id")
    helpful = ctx.body.get("helpful")
    if not isinstance(helpful, bool):
        raise APIError("反馈格式错误")
    row = ctx.conn.execute(
        "SELECT user_id FROM qa_logs WHERE id=?", (log_id,)
    ).fetchone()
    if not row or row["user_id"] != ctx.user["id"]:
        raise APIError("记录不存在", 404)
    ctx.conn.execute(
        "UPDATE qa_logs SET helpful=?, note=? WHERE id=?",
        (1 if helpful else 0, ctx.arg("note")[:300], log_id),
    )
    ctx.conn.commit()
    return {"ok": True}


def history(ctx):
    rows = ctx.conn.execute(
        "SELECT id,question,mode,answered,confidence,created FROM qa_logs "
        "WHERE user_id=? ORDER BY id DESC LIMIT 20",
        (ctx.user["id"],),
    ).fetchall()
    return {"items": [dict(r) for r in rows]}


def suggestions(_ctx):
    return {"items": SUGGESTIONS, "model": _model_state()}


def _model_state():
    endpoint = os.environ.get("CAMPUSCARE_OLLAMA_URL", "")
    return {
        "configured": bool(endpoint),
        "name": os.environ.get("CAMPUSCARE_MODEL", "qwen2.5:7b"),
        "endpoint": endpoint,
    }


def _require_sysadmin(user):
    if user["identity"] != "系统管理员":
        raise APIError("知识库维护属于系统管理员职责，其他角色无权操作", 403)


def knowledge_page(ctx):
    _require_sysadmin(ctx.user)
    data = knowledge.stats()
    return {
        "docs": data["docs"],
        "chunks": data["chunks"],
        "chars": data["chars"],
        "terms": data["terms"],
        "min_score": MIN_SCORE,
        "model": _model_state(),
    }


def gaps(ctx):
    """知识缺口：没答上或答案相关度低的问题，按次数聚合。"""
    _require_sysadmin(ctx.user)
    rows = ctx.conn.execute(
        "SELECT question, count(*) times, max(top_score) best_score, max(created) last_seen "
        "FROM qa_logs WHERE answered=0 GROUP BY lower(question) "
        "ORDER BY times DESC, last_seen DESC LIMIT 20"
    ).fetchall()
    total = ctx.conn.execute("SELECT count(*) FROM qa_logs").fetchone()[0]
    missed = ctx.conn.execute(
        "SELECT count(*) FROM qa_logs WHERE answered=0"
    ).fetchone()[0]
    weak = ctx.conn.execute(
        "SELECT count(*) FROM qa_logs WHERE answered=1 AND confidence<0.52"
    ).fetchone()[0]
    return {
        "items": [dict(r) for r in rows],
        "total": total,
        "missed": missed,
        "weak": weak,
        "answer_rate": round((total - missed) / total, 3) if total else None,
    }


def upload_corpus(ctx):
    """系统管理员上传/覆盖一份语料，写盘后立即重建索引，无需重启服务。"""
    _require_sysadmin(ctx.user)
    name = ctx.arg("filename").lower()
    content = str(ctx.body.get("content", ""))
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{1,39}\.md", name):
        raise APIError("文件名需为 2–40 位小写字母、数字、下划线或短横线，并以 .md 结尾")
    if len(content) < 120:
        raise APIError("正文太短，至少 120 字；请按 ## 章节组织内容")
    if len(content) > 40000:
        raise APIError("单个文件不得超过 4 万字符")
    if "## " not in content:
        raise APIError("至少需要一个 ## 章节标题，否则无法分块引用")

    # 缺少元数据时补一个最简 front-matter，保证引用能显示来源与版本
    if not content.lstrip().startswith("---"):
        stamp = time.strftime("%Y-%m-%d")
        content = (
            f"---\ndoc: UPLOAD-{name[:-3].upper()}\ntitle: {name[:-3]}\n"
            f"owner: 系统管理员上传\nversion: 1.0\nupdated: {stamp}\n---\n\n" + content
        )

    folder = knowledge.corpus_dir()
    if folder is None:
        raise APIError("知识库目录未初始化", 500)
    target = folder / name
    replaced = target.exists()
    target.write_text(content, encoding="utf-8")

    knowledge.load(folder)
    knowledge.sync_db(ctx.conn)
    data = knowledge.stats()
    return {
        "ok": True,
        "filename": name,
        "replaced": replaced,
        "docs": len(data["docs"]),
        "chunks": data["chunks"],
    }


def rebuild(ctx):
    """重建索引：文件被手工修改后，用这个动作刷新检索与分块表。"""
    _require_sysadmin(ctx.user)
    folder = knowledge.corpus_dir()
    if folder is None:
        raise APIError("知识库目录未初始化", 500)
    data = knowledge.load(folder)
    knowledge.sync_db(ctx.conn)
    return {"ok": True, "docs": len(data["docs"]), "chunks": data["chunks"]}


def source(ctx):
    """返回引用文档。

    format=json（默认）返回原文文本，供前端弹窗展示；
    format=docx 直接输出 Word 附件，便于学生保存与打印。
    学生与教师需要核对制度原文，因此对所有已登录账号开放。
    """
    doc_id = ctx.params["doc_id"]
    folder = knowledge.corpus_dir()
    if folder is None:
        raise APIError("知识库目录未初始化", 500)

    for path in sorted(folder.glob("*.md")):
        doc = knowledge.parse_doc(path)
        if doc["doc_id"] != doc_id:
            continue
        content = path.read_text(encoding="utf-8")

        if ctx.arg("format").lower() == "docx":
            meta = f"{doc['owner']} · 版本 {doc['version']} · 更新于 {doc['updated']}"
            payload = docx_export.build(doc["title"], meta, content)
            return FileResponse(
                payload,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                f"{doc['doc_id']}.docx",
            )

        return {
            "doc_id": doc["doc_id"],
            "title": doc["title"],
            "owner": doc["owner"],
            "version": doc["version"],
            "updated": doc["updated"],
            "filename": path.name,
            "chars": len(content),
            "content": content,
        }
    raise APIError("文档不存在", 404)


def routes():
    return [
        ("GET", "/api/qa/suggestions", suggestions),
        ("POST", "/api/qa/ask", ask),
        ("POST", "/api/qa/feedback", feedback),
        ("GET", "/api/qa/history", history),
        ("GET", "/api/qa/knowledge", knowledge_page),
        ("GET", "/api/qa/gaps", gaps),
        ("GET", "/api/qa/source/<doc_id>", source),
        ("POST", "/api/qa/corpus", upload_corpus),
        ("POST", "/api/qa/rebuild", rebuild),
    ]
