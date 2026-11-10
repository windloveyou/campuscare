"""测试支撑：数据库与语料都指向临时目录，避免污染演示数据与仓库文件。"""

import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

TMP = Path(tempfile.mkdtemp(prefix="ccl-test-"))
os.environ["CAMPUSCARE_LEARNING_DB"] = str(TMP / "test.sqlite3")

# 语料复制一份到临时目录：语料上传接口会写文件，测试不能改到仓库里的 corpus/
CORPUS = TMP / "corpus"
shutil.copytree(ROOT / "corpus", CORPUS)
os.environ["CAMPUSCARE_LEARNING_CORPUS"] = str(CORPUS)


def fresh_db():
    from core import db

    db.reset()
    return db


def knowledge_index():
    from modules import knowledge

    knowledge.load(CORPUS)
    return knowledge.get_index()
