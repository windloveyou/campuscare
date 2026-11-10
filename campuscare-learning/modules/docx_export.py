"""把知识库 Markdown 导出为 Word 文档（.docx）。

只用标准库：手写最小 OOXML，用 zipfile 打包。正文使用宋体（eastAsia="SimSun"），
标题加粗，适合学生下载后打印或摘录条款。
"""

import io
import re
import zipfile
from xml.sax.saxutils import escape

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"""

RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""

FONTS = ('<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" '
         'w:eastAsia="SimSun" w:cs="SimSun"/>')


def _run(text, bold=False, size=22, color=None):
    props = f"<w:rPr>{FONTS}"
    if bold:
        props += "<w:b/>"
    if color:
        props += f'<w:color w:val="{color}"/>'
    props += f'<w:sz w:val="{size}"/><w:szCs w:val="{size}"/></w:rPr>'
    return f'<w:r>{props}<w:t xml:space="preserve">{escape(text)}</w:t></w:r>'


def _para(runs, before=0, after=120, line=340, align=None, indent=0):
    props = (
        f'<w:pPr><w:spacing w:before="{before}" w:after="{after}" w:line="{line}" '
        f'w:lineRule="auto"/>'
    )
    if indent:
        props += f'<w:ind w:firstLine="{indent}"/>'
    if align:
        props += f'<w:jc w:val="{align}"/>'
    props += "</w:pPr>"
    return f"<w:p>{props}{runs}</w:p>"


def _inline(text):
    """去掉 Markdown 行内标记，保留可读的文字。"""
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"`(.+?)`", r"\1", text)
    text = re.sub(r"\[(.+?)\]\((.+?)\)", r"\1", text)
    return text.strip()


def _blocks(markdown):
    """把 Markdown 切成 [(kind, text)]，kind 取 title/h2/h3/li/p。"""
    lines = markdown.splitlines()
    # 跳过 YAML front-matter
    if lines and lines[0].strip() == "---":
        for index in range(1, len(lines)):
            if lines[index].strip() == "---":
                lines = lines[index + 1:]
                break

    out = []
    for line in lines:
        raw = line.rstrip()
        stripped = raw.strip()
        if not stripped:
            continue
        if stripped.startswith("#### "):
            out.append(("h3", _inline(stripped[5:])))
        elif stripped.startswith("### "):
            out.append(("h3", _inline(stripped[4:])))
        elif stripped.startswith("## "):
            out.append(("h2", _inline(stripped[3:])))
        elif stripped.startswith("# "):
            out.append(("title", _inline(stripped[2:])))
        elif stripped.startswith(("- ", "* ")):
            out.append(("li", _inline(stripped[2:])))
        elif stripped.startswith("|"):
            continue  # 表格不导出，避免结构错乱
        else:
            out.append(("p", _inline(stripped)))
    return out


def build(title, meta_line, markdown):
    """生成 .docx 字节流。"""
    body = [_para(_run(title, bold=True, size=34), after=80)]
    if meta_line:
        body.append(_para(_run(meta_line, size=18, color="6B6B6B"), after=200))

    for kind, text in _blocks(markdown):
        if kind == "title":
            continue  # 标题已用文档标题
        if kind == "h2":
            body.append(_para(_run(text, bold=True, size=26), before=200, after=100))
        elif kind == "h3":
            body.append(_para(_run(text, bold=True, size=23), before=140, after=80))
        elif kind == "li":
            body.append(_para(_run("· " + text, size=22), after=80, indent=240))
        else:
            body.append(_para(_run(text, size=22), after=120, indent=420))

    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        "<w:body>" + "".join(body) +
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
        '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" '
        'w:header="851" w:footer="992" w:gutter="0"/></w:sectPr>'
        "</w:body></w:document>"
    )

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", CONTENT_TYPES)
        archive.writestr("_rels/.rels", RELS)
        archive.writestr("word/document.xml", document)
    return buffer.getvalue()
