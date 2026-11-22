"""测试隔离：所有 pytest 用例使用独立的临时 SQLite，绝不写入 data/dev.db。

必须在导入 app 之前设置 DATABASE_URL（app.settings / app.db 在导入时读取）。
"""

from __future__ import annotations

import os
import tempfile

_TEST_DIR = tempfile.mkdtemp(prefix="xzm-pytest-")
os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DIR}/test.db"

# Default in-process clients model the real local UI/CLI. Tests of untrusted
# clients pass explicit client/base_url values and exercise the production guard.
from functools import wraps
from starlette.testclient import TestClient

_client_init = TestClient.__init__

@wraps(_client_init)
def _local_client_init(self, *args, **kwargs):
    if len(args) < 2:
        kwargs.setdefault('base_url', 'http://127.0.0.1')
    kwargs.setdefault('client', ('127.0.0.1', 50000))
    return _client_init(self, *args, **kwargs)

TestClient.__init__ = _local_client_init
