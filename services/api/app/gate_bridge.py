"""Call the single TypeScript gate implementation over a persistent local pipe.

One serialized engine per Python process; no HTTP/LLM queue dependency and no
Python rule fallback. A broken transport is killed and fails closed.
"""
from __future__ import annotations

import atexit
import json
import math
import os
from pathlib import Path
import selectors
import shutil
import subprocess
import threading
import time
from typing import Any

_ENTRY = Path(__file__).resolve().parents[1] / 'gate-engine' / 'server.mjs'
_MAX_MESSAGE = 16 * 1024 * 1024


class GateEngineError(RuntimeError):
    """Gate evaluation could not be established; never equivalent to pass."""


class GateBridge:
    def __init__(self, *, node: str | None = None, entry: Path | None = None, timeout: float | None = None):
        self.node = node or os.environ.get('GATE_ENGINE_NODE') or shutil.which('node') or 'node'
        self.entry = entry or _ENTRY
        self.timeout = float(timeout if timeout is not None else os.environ.get('GATE_ENGINE_TIMEOUT_S', '10'))
        if not math.isfinite(self.timeout) or self.timeout <= 0:
            raise ValueError('GATE_ENGINE_TIMEOUT_S must be finite and positive')
        self._owner = os.getpid()
        self._lock = threading.RLock()
        self._process: subprocess.Popen | None = None
        self._sequence = 0
        self._buffer = b''
        self._source_state: tuple | None = None

    @property
    def pid(self) -> int | None:
        return self._process.pid if self._process and self._process.poll() is None else None

    def _after_fork(self) -> None:
        if self._owner != os.getpid():
            # Close only inherited handles. The parent's engine belongs to it.
            self._close_handles()
            self._process = None
            self._buffer = b''
            self._owner = os.getpid()
            self._lock = threading.RLock()

    def _close_handles(self) -> None:
        if self._process:
            for handle in (self._process.stdin, self._process.stdout):
                if handle:
                    handle.close()

    def _stop(self) -> None:
        process = self._process
        if process:
            if self._owner == os.getpid() and process.poll() is None:
                process.kill()
                process.wait(timeout=2)
            self._close_handles()
        self._process = None
        self._buffer = b''

    def close(self) -> None:
        self._after_fork()
        with self._lock:
            self._stop()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def _start(self) -> None:
        # Native Node imports are cached. Watch the small, explicit dependency
        # set so local TS edits cannot leave Python on an older rule revision.
        sources = [self.entry]
        if self.entry == _ENTRY:
            root = (self.entry.parent / '../../..').resolve()
            sources.extend(root / path for path in (
                'packages/domain/src/gateRules.ts',
                'packages/domain/src/gates.ts',
                'packages/agent-runtime/src/gates.ts',
                'packages/agent-runtime/src/gates.extended.ts',
            ))
        try:
            source_state = tuple((path.stat().st_mtime_ns, path.stat().st_size) for path in sources)
        except OSError as error:
            self._stop()
            raise GateEngineError('共享 Gate 规则文件不可用') from error
        if self.pid and source_state == self._source_state:
            return
        self._stop()
        try:
            self._process = subprocess.Popen(
                [self.node, '--experimental-strip-types', str(self.entry)],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                bufsize=0, close_fds=True,
            )
            os.set_blocking(self._process.stdin.fileno(), False)
            os.set_blocking(self._process.stdout.fileno(), False)
            self._source_state = source_state
        except OSError as error:
            self._stop()
            raise GateEngineError('共享 Gate 引擎无法启动，请检查 Node.js 22.6+ 与规则文件') from error

    def _ready(self, fd: int, event: int, deadline: float) -> None:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise GateEngineError('共享 Gate 引擎响应超时')
        with selectors.DefaultSelector() as selector:
            selector.register(fd, event)
            if not selector.select(remaining):
                raise GateEngineError('共享 Gate 引擎响应超时')

    def call(self, function_name: str, *args: Any) -> Any:
        self._after_fork()
        with self._lock:
            self._sequence += 1
            request_id = self._sequence
            try:
                payload = (json.dumps({'version':1, 'id':request_id, 'function':function_name, 'args':args},
                                      ensure_ascii=False, allow_nan=False) + '\n').encode('utf-8')
            except (TypeError, ValueError, UnicodeError) as error:
                raise GateEngineError('Gate 输入不是有效 JSON 数据') from error
            if len(payload) > _MAX_MESSAGE:
                raise GateEngineError('Gate 输入超过传输上限')
            try:
                self._start()
                deadline = time.monotonic() + self.timeout
                write_fd = self._process.stdin.fileno()
                sent = 0
                while sent < len(payload):
                    self._ready(write_fd, selectors.EVENT_WRITE, deadline)
                    try:
                        sent += os.write(write_fd, payload[sent:])
                    except BlockingIOError:
                        continue
                read_fd = self._process.stdout.fileno()
                while b'\n' not in self._buffer:
                    self._ready(read_fd, selectors.EVENT_READ, deadline)
                    try:
                        chunk = os.read(read_fd, 65536)
                    except BlockingIOError:
                        continue
                    if not chunk:
                        raise GateEngineError('共享 Gate 引擎意外退出')
                    self._buffer += chunk
                    if len(self._buffer) > _MAX_MESSAGE:
                        raise GateEngineError('Gate 响应超过传输上限')
                line, self._buffer = self._buffer.split(b'\n', 1)
                response = json.loads(line)
                if not isinstance(response, dict) or response.get('version') != 1 or response.get('id') != request_id:
                    raise GateEngineError('共享 Gate 引擎协议不匹配')
            except (OSError, ValueError, GateEngineError) as error:
                self._stop()
                if isinstance(error, GateEngineError):
                    raise
                raise GateEngineError('共享 Gate 引擎通信失败') from error
            if response.get('ok') is not True:
                message = response.get('error') or {}
                if not isinstance(message, dict):
                    self._stop()
                    raise GateEngineError('共享 Gate 引擎错误响应无效')
                raise GateEngineError(f"Gate 求值失败：{message.get('message', 'unknown error')}")
            if 'result' not in response:
                self._stop()
                raise GateEngineError('共享 Gate 引擎缺少求值结果')
            return response['result']


_engine = GateBridge()
atexit.register(_engine.close)


def call_gate(function_name: str, *args: Any) -> Any:
    return _engine.call(function_name, *args)


def close_gate_engine() -> None:
    _engine.close()
