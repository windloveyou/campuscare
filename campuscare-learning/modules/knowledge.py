"""M1 检索引擎：语料解析 → 分块 → BM25 检索。

为什么不用向量库：
1. 课程原型不能下载模型、不能依赖外网，BM25 只依赖标准库，课堂现场可复现；
2. 制度类问答的关键词高度确定（"延期""退选""补考"），词项检索的准确率足够，
   且每个分数都能解释给评审看；
3. 检索接口与生成接口分离，将来把 BM25 换成向量检索只需替换 Index.search()。
"""

import math
import re
from collections import Counter
from pathlib import Path

CJK_RUN = re.compile(r"[\u4e00-\u9fff]+")
ASCII_WORD = re.compile(r"[a-z0-9]+")

MAX_CHARS = 480
MIN_CHARS = 160

# 中文问句里的高频虚词，切出的二元字对检索没有区分度
STOPWORDS = {
    "什么", "怎么", "如何", "请问", "可以", "是否", "需要", "应该", "我们", "学校",
    "这个", "那个", "哪些", "多少", "为什", "么样", "一下", "的时", "时候", "如果",
    "有没", "没有", "是不", "不是", "我想", "我要", "以及", "还有", "但是", "所以",
}

# 单字噪声：中文按字切分后，这些字几乎出现在所有段落里
CHAR_STOP = set("的了是在和与或有个这那你我他她它吗呢吧啊么就都也还很太更最把被让给对从到为以之其而及等如若请")

# 口语 → 制度用语。学生问"挂科"，文档里写"不及格"，不做这层映射就检索不到。
SYNONYMS = {
    "挂科": ["不及格", "低于50"],
    "不及格": ["补考", "重修"],
    "补考": ["重修", "低于50"],
    "重修": ["补考"],
    "退课": ["退选", "withdrawn"],
    "退选": ["退课"],
    "休学": ["复学", "学籍"],
    "复学": ["休学"],
    "分数": ["成绩", "评分"],
    "成绩": ["评分", "加权平均"],
    "查重": ["学术不端", "抄袭"],
    "抄": ["学术不端", "抄袭"],
    "AI": ["生成式人工智能"],
    "人工智能": ["生成式人工智能"],
    "chatgpt": ["生成式人工智能"],
    "机房": ["实验室", "计算机"],
    "自习": ["图书馆", "座位"],
    "借书": ["借阅", "图书馆"],
    "还书": ["借阅", "超期"],
    "密码": ["重置", "统一认证"],
    "断网": ["校园网", "网络"],
    "上网": ["校园网", "网络"],
    "预约": ["预订", "审批"],
    "场地": ["教室", "实验室", "场馆"],
    "预警": ["学业预警", "学业导师"],
    "几级": ["等级", "分级"],
    "几个等级": ["等级"],
    "分级": ["等级"],
    "奖学金": ["助学金", "评定"],
    "学费": ["缓缴", "缴费"],
    "心理": ["心理咨询", "支持"],
    "延期": ["截止", "逾期"],
    "迟交": ["延期", "逾期"],
    "晚交": ["延期", "逾期", "扣减"],
    "逾期": ["延期", "扣减"],
    "扣分": ["扣减", "零分"],
    "扣多少": ["扣减"],
    "作弊": ["学术不端"],
    "请假": ["延期", "证明"],
    "宿舍": ["住宿"],
}


def clean(tokens):
    return [t for t in tokens if t not in STOPWORDS and t not in CHAR_STOP]


def tokenize(text):
    """中文取二元字 + 单字（单字用于兜底召回），英文/数字取整词。"""
    text = (text or "").lower()
    tokens = [w for w in ASCII_WORD.findall(text) if len(w) > 1]
    for run in CJK_RUN.findall(text):
        tokens.extend(run)
        if len(run) > 1:
            tokens.extend(run[i : i + 2] for i in range(len(run) - 1))
    return tokens


def parse_doc(path):
    """解析带 front-matter 的 Markdown，返回文档元数据与章节列表。"""
    raw = Path(path).read_text(encoding="utf-8")
    meta, body = {}, raw
    if raw.startswith("---"):
        _, front, body = raw.split("---", 2)
        for line in front.strip().splitlines():
            if ":" in line:
                key, value = line.split(":", 1)
                meta[key.strip()] = value.strip()

    sections, current = [], ("概述", [])
    for line in body.splitlines():
        if line.startswith("## "):
            if "".join(current[1]).strip():
                sections.append(current)
            current = (line[3:].strip(), [])
        elif line.startswith("# "):
            continue
        else:
            current[1].append(line)
    if "".join(current[1]).strip():
        sections.append(current)

    return {
        "doc_id": meta.get("doc", Path(path).stem),
        "title": meta.get("title", Path(path).stem),
        "owner": meta.get("owner", "未标注"),
        "version": meta.get("version", "—"),
        "updated": meta.get("updated", "—"),
        "sections": [
            {"section": name, "text": "\n".join(lines).strip()}
            for name, lines in sections
        ],
    }


def split_long(text):
    """段落超长时按句号切成不超过 MAX_CHARS 的片段。"""
    if len(text) <= MAX_CHARS:
        return [text]
    pieces = re.split(r"(?<=[。！？；])", text)
    out, buffer = [], ""
    for piece in pieces:
        if len(buffer) + len(piece) > MAX_CHARS and buffer:
            out.append(buffer)
            buffer = piece
        else:
            buffer += piece
    if buffer.strip():
        out.append(buffer)
    return [p.strip() for p in out if p.strip()]


def build_chunks(corpus_dir):
    """把每个 ## 章节切成 160–480 字的块，块是检索与引用的最小单位。"""
    chunks = []
    for path in sorted(Path(corpus_dir).glob("*.md")):
        doc = parse_doc(path)
        for sec_no, section in enumerate(doc["sections"], start=1):
            paragraphs = [
                p.strip() for p in section["text"].split("\n\n") if p.strip()
            ]
            buffer, ordinal = "", 0
            pieces = []
            for para in paragraphs:
                for part in split_long(para):
                    if len(buffer) + len(part) <= MAX_CHARS:
                        buffer = (buffer + "\n\n" + part).strip()
                    else:
                        if buffer:
                            pieces.append(buffer)
                        buffer = part
                        if len(buffer) >= MIN_CHARS:
                            pieces.append(buffer)
                            buffer = ""
            if buffer.strip():
                pieces.append(buffer)
            for piece in pieces:
                chunks.append(
                    {
                        "id": f"{doc['doc_id']}#S{sec_no:02d}-{ordinal:02d}",
                        "doc_id": doc["doc_id"],
                        "doc_title": doc["title"],
                        "doc_owner": doc["owner"],
                        "doc_version": doc["version"],
                        "doc_updated": doc["updated"],
                        "section": section["section"],
                        "section_no": sec_no,
                        "ordinal": ordinal,
                        "text": piece,
                    }
                )
                ordinal += 1
    return chunks


class Index:
    """BM25（k1=1.4, b=0.65）。标题 ×3、章节名 ×2 参与索引，起到字段加权作用。"""

    K1, B = 1.4, 0.65
    TITLE_REPEAT, SECTION_REPEAT = 3, 2
    CHAR_WEIGHT = 0.38  # 单字只做兜底召回，权重压低避免泛化

    def __init__(self, chunks):
        self.chunks = chunks
        self.terms = []
        self.df = Counter()
        for chunk in chunks:
            raw = []
            for _ in range(self.TITLE_REPEAT):
                raw.extend(tokenize(chunk["doc_title"]))
            for _ in range(self.SECTION_REPEAT):
                raw.extend(tokenize(chunk["section"]))
            raw.extend(tokenize(chunk["text"]))
            tokens = clean(raw)
            self.terms.append(Counter(tokens))
            for term in set(tokens):
                self.df[term] += 1
        self.lengths = [sum(tf.values()) for tf in self.terms]
        self.avgdl = (sum(self.lengths) / len(self.lengths)) if self.lengths else 1.0

    def expand(self, query):
        """返回 (原始词项, 同义词项)；同义词权重较低，只用于补召回。"""
        base = clean(tokenize(query))
        extra = []
        lowered = query.lower()
        for word, aliases in SYNONYMS.items():
            if word.lower() in lowered:
                for alias in aliases:
                    extra.extend(tokenize(alias))
        return base, clean(extra)

    def search(self, query, limit=6):
        base, extra = self.expand(query)
        weights = {}
        for term in base:
            weights[term] = 1.0
        for term in extra:
            weights[term] = max(weights.get(term, 0), 0.45)
        if not weights:
            return []

        scored = []
        for i, tf in enumerate(self.terms):
            score = 0.0
            dl = self.lengths[i] or 1
            for term, weight in weights.items():
                freq = tf.get(term)
                if not freq:
                    continue
                df = self.df.get(term, 0)
                idf = math.log(1 + (len(self.terms) - df + 0.5) / (df + 0.5))
                denom = freq + self.K1 * (1 - self.B + self.B * dl / self.avgdl)
                local = weight * (self.CHAR_WEIGHT if len(term) == 1 else 1.0)
                score += local * idf * freq * (self.K1 + 1) / denom
            if score > 0:
                scored.append((score, i))

        scored.sort(key=lambda pair: -pair[0])
        results = []
        for score, i in scored[:limit]:
            chunk = self.chunks[i]
            results.append(
                {
                    **chunk,
                    "score": round(score, 3),
                    # 展示命中的词项：优先二元词（可读），单字垫底
                    "matched": sorted(
                        {t for t in weights if self.terms[i].get(t)},
                        key=lambda t: (-len(t), t),
                    )[:6],
                }
            )
        return results


_INDEX = {"key": None, "dir": None, "index": Index([]), "stats": {}}


def load(corpus_dir):
    chunks = build_chunks(corpus_dir)
    _INDEX["index"] = Index(chunks)
    _INDEX["key"] = str(Path(corpus_dir).resolve())
    _INDEX["dir"] = Path(corpus_dir)
    docs = {}
    for chunk in chunks:
        entry = docs.setdefault(
            chunk["doc_id"],
            {
                "doc_id": chunk["doc_id"],
                "title": chunk["doc_title"],
                "owner": chunk["doc_owner"],
                "version": chunk["doc_version"],
                "updated": chunk["doc_updated"],
                "sections": set(),
                "chunks": 0,
                "chars": 0,
            },
        )
        entry["sections"].add(chunk["section"])
        entry["chunks"] += 1
        entry["chars"] += len(chunk["text"])
    for entry in docs.values():
        entry["sections"] = sorted(entry["sections"])
    _INDEX["stats"] = {
        "docs": sorted(docs.values(), key=lambda d: d["doc_id"]),
        "chunks": len(chunks),
        "chars": sum(len(c["text"]) for c in chunks),
        "terms": len(_INDEX["index"].df),
    }
    return _INDEX["stats"]


def get_index():
    return _INDEX["index"]


def corpus_dir():
    return _INDEX["dir"]


def stats():
    return _INDEX["stats"]


def sync_db(conn):
    """把语料写入 kb_chunks，供管理页展示知识库覆盖情况。"""
    chunks = get_index().chunks
    conn.execute("DELETE FROM kb_chunks")
    conn.executemany(
        "INSERT INTO kb_chunks(id,doc_id,doc_title,doc_owner,doc_version,doc_updated,section,ordinal,text)"
        " VALUES(?,?,?,?,?,?,?,?,?)",
        [
            (
                c["id"],
                c["doc_id"],
                c["doc_title"],
                c["doc_owner"],
                c["doc_version"],
                c["doc_updated"],
                c["section"],
                c["ordinal"],
                c["text"],
            )
            for c in chunks
        ],
    )
    conn.commit()
