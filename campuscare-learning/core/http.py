"""极简路由与上下文对象。

模块只依赖这里定义的契约，不直接碰 BaseHTTPRequestHandler：
    routes() -> [(method, pattern, handler), ...]
    handler(ctx) -> dict / (dict, status)
这样把某个模块搬到主系统时，只需要在 server.py 里把 routes() 注册进路由表。
"""

import json
import re


class APIError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


class FileResponse:
    """处理器返回该对象时，按附件下载输出，而不是 JSON。"""

    def __init__(self, content, content_type, filename):
        self.content = content
        self.content_type = content_type
        self.filename = filename


class Ctx:
    """一次请求的上下文。"""

    def __init__(self, conn, user, body=None, query=None, params=None, client=""):
        self.conn = conn
        self.user = user
        self.body = body or {}
        self.query = query or {}
        self.params = params or {}
        self.client = client

    def arg(self, name, default=""):
        """取字符串参数（body 优先，其次 query），并做长度限制。"""
        value = self.body.get(name, self.query.get(name, default))
        if value is None:
            return default
        return str(value).strip()

    def need(self, name, message, limit=2000):
        value = self.arg(name)
        if not value:
            raise APIError(message)
        return value[:limit]


class Router:
    def __init__(self):
        self.table = []

    def add(self, method, pattern, handler):
        regex = re.sub(r"<(\w+)>", r"(?P<\1>[^/]+)", pattern)
        self.table.append((method.upper(), re.compile("^" + regex + "$"), handler))

    def include(self, module):
        for method, pattern, handler in module.routes():
            self.add(method, pattern, handler)

    def match(self, method, path):
        for verb, regex, handler in self.table:
            if verb != method.upper():
                continue
            found = regex.match(path)
            if found:
                return handler, found.groupdict()
        return None, None


def clamp(value, low=0.0, high=1.0):
    return max(low, min(high, value))


def to_json(payload):
    return json.dumps(payload, ensure_ascii=False, default=str).encode()
