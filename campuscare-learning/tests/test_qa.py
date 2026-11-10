"""Module 1 单元测试：检索命中、拒答守卫、引用编号一致性。"""

import re
import unittest

from tests import support

support.knowledge_index()

from modules import knowledge, learning_qa  # noqa: E402


class RetrievalTest(unittest.TestCase):
    def setUp(self):
        self.index = knowledge.get_index()

    def test_corpus_is_indexed(self):
        stats = knowledge.stats()
        self.assertGreaterEqual(len(stats["docs"]), 6)
        self.assertGreater(stats["chunks"], 20)
        self.assertGreater(stats["chars"], 3000)

    def test_numbered_sections_are_separate_chunks(self):
        """每个 ## 章节至少一个段落，段落不跨章节合并。"""
        sections = {(chunk["doc_id"], chunk["section"]) for chunk in self.index.chunks}
        self.assertGreaterEqual(len(sections), 40)
        for chunk in self.index.chunks:
            self.assertLessEqual(len(chunk["text"]), knowledge.MAX_CHARS + 40)

    def test_known_questions_hit_expected_section(self):
        cases = {
            "作业晚交几天会扣多少分？": "作业延期提交",
            "期末挂科了怎么办": "补考与重修",
            "第几周还能退课": "退选",
            "忘记密码怎么办": "密码重置",
            "学业预警有几级": "预警等级",
            "休学最长多久": "休学与复学",
            "教室要提前几天预约": "预约开放时间",
        }
        for question, expected in cases.items():
            with self.subTest(question=question):
                hits = self.index.search(question, 4)
                self.assertTrue(hits, f"没有检索到任何段落：{question}")
                self.assertIn(
                    expected,
                    hits[0]["section"],
                    f"首段命中 {hits[0]['section']}，期望包含 {expected}",
                )

    def test_synonym_expansion_links_colloquial_terms(self):
        """口语"挂科"要能召回写"不及格"的段落。"""
        hits = self.index.search("我挂科了", 4)
        self.assertTrue(any("补考" in hit["section"] for hit in hits))

    def test_unrelated_question_scores_below_threshold(self):
        for question in ["今天天气怎么样", "食堂几点开门", "我室友叫什么名字"]:
            with self.subTest(question=question):
                hits = self.index.search(question, 4)
                top = hits[0]["score"] if hits else 0
                self.assertLess(top, learning_qa.MIN_SCORE)


class AnswerTest(unittest.TestCase):
    def test_answer_cites_source(self):
        result = learning_qa.answer("期末挂科了怎么办")
        self.assertTrue(result["answered"])
        self.assertTrue(result["citations"])
        self.assertIn("[1]", result["answer"])
        self.assertEqual(result["mode"], "extractive")

    def test_citation_numbers_match_sources(self):
        """正文里的 [n] 必须能在 citations 里找到同名条目，且指向的段落一致。"""
        for question in ["作业晚交几天会扣多少分？", "期末挂科了怎么办", "知识库是什么"]:
            with self.subTest(question=question):
                result = learning_qa.answer(question)
                if not result["answered"]:
                    continue
                markers = {int(n) for n in re.findall(r"\[(\d)\]", result["answer"])}
                numbers = {c["n"] for c in result["citations"]}
                self.assertEqual(markers, numbers)
                for citation in result["citations"]:
                    self.assertTrue(citation["doc_title"])
                    self.assertTrue(citation["section"])

    def test_guardrail_refuses_without_evidence(self):
        result = learning_qa.answer("食堂今天中午有什么菜")
        self.assertFalse(result["answered"])
        self.assertEqual(result["mode"], "guardrail")
        self.assertEqual(result["citations"], [])
        self.assertIsNotNone(result["guardrail"])
        self.assertIn("没有检索到", result["answer"])

    def test_confidence_in_range(self):
        for question in ["作业晚交扣多少分", "怎么申请休学"]:
            result = learning_qa.answer(question)
            self.assertGreaterEqual(result["confidence"], 0)
            self.assertLessEqual(result["confidence"], 1)

    def test_complex_question_cites_multiple_documents(self):
        """复杂问题应同时引用多份文件，而不是只给一个来源。"""
        result = learning_qa.answer("期末挂科了怎么办，会不会被学业预警")
        self.assertTrue(result["answered"])
        self.assertGreaterEqual(len(result["citations"]), 2)
        documents = {c["doc_id"] for c in result["citations"]}
        self.assertGreaterEqual(len(documents), 2)

    def test_simple_question_keeps_single_source(self):
        result = learning_qa.answer("图书馆一次能借几本书")
        self.assertTrue(result["answered"])
        self.assertEqual(len(result["citations"]), 1)

    def test_followups_are_suggested(self):
        result = learning_qa.answer("期末挂科了怎么办")
        self.assertTrue(result["followups"])
        self.assertLessEqual(len(result["followups"]), 3)
        for item in result["followups"]:
            self.assertTrue(item["question"].endswith("？"))
            self.assertTrue(item["doc_title"])

    def test_docx_export_is_valid_package(self):
        import io
        import zipfile

        from modules import docx_export

        payload = docx_export.build(
            "测试文件", "教务处 · 版本 1.0", "## 1. 章节\n\n第一段内容。\n\n- 条目一\n"
        )
        self.assertTrue(payload.startswith(b"PK"))
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            names = set(archive.namelist())
            self.assertIn("word/document.xml", names)
            document = archive.read("word/document.xml").decode("utf-8")
        self.assertIn("测试文件", document)
        self.assertIn("第一段内容", document)

    def test_short_question_rejected_by_api_layer(self):
        from core.http import APIError, Ctx

        ctx = Ctx(conn=None, user={"id": "x", "identity": "学生"}, body={"question": "啊"})
        with self.assertRaises(APIError):
            learning_qa.ask(ctx)


if __name__ == "__main__":
    unittest.main()
