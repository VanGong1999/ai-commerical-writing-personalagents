"""User-configured text directories. No model-facing operation can create mounts.

Open every path component relative to a pinned directory descriptor, without
following symlinks. This also closes resolve/check/open races during writes.
"""
from __future__ import annotations

from contextlib import contextmanager
import hashlib
import os
from pathlib import Path
import re
import stat
import threading
from uuid import uuid4

try:
    import fcntl
except ImportError:  # Safe mounts are unavailable on platforms without these primitives.
    fcntl = None

from sqlmodel import Session, select

from .models import AppSetting, utcnow

CONFIG_KEY = 'fs.directory_mounts'
VERSION_PREFIX = 'fs.directory_version.'
MAX_BYTES = 1024 * 1024
TEXT_SUFFIXES = {'.txt', '.md', '.json', '.csv', '.yaml', '.yml', '.rst'}
_SENSITIVE = re.compile(r'credential|secret|password|passwd|token|private.?key|id_rsa|id_ed25519', re.I)
_LOCK = threading.RLock()


class MountError(Exception):
    def __init__(self, message: str, code: str = 'forbidden'):
        super().__init__(message)
        self.code = code


def _check_platform() -> None:
    if (not hasattr(os, 'O_DIRECTORY') or not hasattr(os, 'O_NOFOLLOW')
            or fcntl is None or os.open not in os.supports_dir_fd or os.listdir not in os.supports_fd):
        raise MountError('当前平台不支持安全目录挂载；需要支持目录描述符及禁止符号链接的文件系统', 'bad_path')


def list_mounts(session: Session) -> list[dict]:
    row = session.get(AppSetting, CONFIG_KEY)
    return list((row.value_json if row else {}).get('mounts', []))


def put_mount(session: Session, name: str, root: str, read_only: bool = True) -> dict:
    _check_platform()
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,47}', name):
        raise MountError('目录名称须为 1–48 个英文字母、数字、下划线或短横线', 'bad_path')
    supplied = Path(root).expanduser()
    if not supplied.is_absolute():
        raise MountError('请选择绝对目录路径', 'bad_path')
    try:
        resolved = supplied.resolve(strict=True)
        if not resolved.is_dir():
            raise MountError('挂载来源必须是目录', 'bad_path')
    except OSError as exc:
        raise MountError('目录不存在或不可访问', 'not_found') from exc
    mount = {'name': name, 'root': str(resolved), 'readOnly': read_only}
    with _LOCK:
        rows = [item for item in list_mounts(session) if item['name'] != name]
        if len(rows) >= 16:
            raise MountError('最多添加 16 个目录', 'bad_path')
        row = session.get(AppSetting, CONFIG_KEY) or AppSetting(key=CONFIG_KEY)
        row.value_json = {'mounts': [*rows, mount]}
        row.updated_at = utcnow()
        session.add(row)
        session.commit()
    return mount


def delete_mount(session: Session, name: str) -> None:
    with _LOCK:
        row = session.get(AppSetting, CONFIG_KEY)
        if row:
            row.value_json = {'mounts': [m for m in list_mounts(session) if m['name'] != name]}
            row.updated_at = utcnow()
            session.add(row)
            session.commit()


def _visible(name: str) -> bool:
    return bool(name) and not name.startswith('.') and not _SENSITIVE.search(name)


def _parse(session: Session, path: str) -> tuple[dict, list[str]]:
    parts = path.split('/')
    if len(parts) < 3 or parts[:2] != ['', 'files']:
        raise MountError('仅支持已挂载目录路径', 'bad_path')
    relative = parts[3:]
    if any(part in {'.', '..', ''} or '\\' in part or '\x00' in part for part in parts[2:]):
        raise MountError('目录路径无效或试图越界', 'path_escape')
    mount = next((m for m in list_mounts(session) if m['name'] == parts[2]), None)
    if mount is None:
        raise MountError('目录尚未挂载', 'not_found')
    if any(not _visible(part) for part in relative):
        raise MountError('隐藏文件和凭据文件不对助手开放')
    return mount, relative


@contextmanager
def _directory(root: str, components: list[str]):
    _check_platform()
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in [*Path(root).parts[1:], *components]:
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        yield fd
    except OSError as exc:
        raise MountError('目录不存在、不可访问或包含符号链接', 'path_escape') from exc
    finally:
        os.close(fd)


def _read_at(parent: int, name: str) -> str:
    if Path(name).suffix.lower() not in TEXT_SUFFIXES or not _visible(name):
        raise MountError('仅开放 txt/md/json/csv/yaml/yml/rst 文本文件')
    try:
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        with os.fdopen(fd, 'rb') as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_BYTES:
                raise MountError('只支持不超过 1 MiB 的普通文本文件', 'bad_path')
            data = stream.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise MountError('文件超过 1 MiB，请拆分后读取', 'bad_path')
        text = data.decode('utf-8')
        if any(ord(ch) < 32 and ch not in '\n\r\t' for ch in text):
            raise MountError('文件包含二进制内容', 'bad_path')
        return text
    except FileNotFoundError as exc:
        raise MountError('文件不存在', 'not_found') from exc
    except (OSError, UnicodeDecodeError) as exc:
        raise MountError('文件必须是 UTF-8 文本，且不能是符号链接', 'bad_path') from exc


def digest(text: str) -> str:
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def _original_text(session: Session, path: str) -> str:
    mount, parts = _parse(session, path)
    if not parts:
        raise MountError('请选择文本文件', 'bad_path')
    with _directory(mount['root'], parts[:-1]) as parent:
        return _read_at(parent, parts[-1])


def read_source(session: Session, path: str) -> str:
    # Browser textareas normalize line endings; reference offsets must match.
    return _original_text(session, path).replace('\r\n', '\n').replace('\r', '\n')


def read_text(session: Session, path: str) -> dict:
    original = _original_text(session, path)
    mount, _ = _parse(session, path)
    normalized = original.replace('\r\n', '\n').replace('\r', '\n')
    return {'text': normalized, 'contentHash': digest(normalized),
            'hash': digest(original), 'readOnly': mount['readOnly']}


def ls(session: Session, path: str) -> list[dict]:
    if path == '/files':
        return [{'name': m['name'], 'type': 'dir', 'path': '/files/' + m['name'],
                 'readOnly': m['readOnly']} for m in list_mounts(session)]
    mount, parts = _parse(session, path)
    with _directory(mount['root'], parts) as directory:
        names = os.listdir(directory)
        if len(names) > 2000:
            raise MountError('目录条目过多，请选择较小的创作目录', 'bad_path')
        entries = []
        for name in sorted(names):
            if not _visible(name):
                continue
            try:
                info = os.stat(name, dir_fd=directory, follow_symlinks=False)
                if stat.S_ISDIR(info.st_mode):
                    kind = 'dir'
                elif stat.S_ISREG(info.st_mode):
                    _read_at(directory, name)  # apply UTF-8, size and binary filter to discovery
                    kind = 'file'
                else:
                    continue
            except (OSError, MountError):
                continue
            entries.append({'name': name, 'type': kind, 'path': path + '/' + name})
        return entries


def write_text(session: Session, path: str, text: str, expected_hash: str | None) -> dict:
    mount, parts = _parse(session, path)
    if mount['readOnly']:
        raise MountError('此目录为只读；请在设置中启用写入', 'readonly')
    if expected_hash is None:
        raise MountError('写入需要读取所得 expected_hash；新文件使用空字符串', 'conflict')
    if not parts or Path(parts[-1]).suffix.lower() not in TEXT_SUFFIXES:
        raise MountError('请选择支持的文本文件', 'bad_path')
    try:
        data = text.encode('utf-8')
    except UnicodeEncodeError as exc:
        raise MountError('文本包含无效 Unicode', 'bad_path') from exc
    if len(data) > MAX_BYTES or any(ord(ch) < 32 and ch not in '\n\r\t' for ch in text):
        raise MountError('只支持不超过 1 MiB 的 UTF-8 文本', 'bad_path')
    with _LOCK, _directory(mount['root'], parts[:-1]) as parent:
        # Coordinate our own writers across API processes as well as threads.
        # The descriptor close releases this advisory lock even on exceptions.
        fcntl.flock(parent, fcntl.LOCK_EX)
        name = parts[-1]
        try:
            original = _read_at(parent, name)
        except MountError as exc:
            if exc.code != 'not_found':
                raise
            original = None
        current_hash = digest(original) if original is not None else ''
        if current_hash != expected_hash:
            raise MountError('文件已变化，请重新读取后比较', 'conflict')
        temporary = '.xzm-' + uuid4().hex
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
        version_id = None
        try:
            with os.fdopen(fd, 'wb') as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            if original is not None:
                # Recheck after preparing the candidate, immediately before replacing.
                if digest(_read_at(parent, name)) != expected_hash:
                    raise MountError('文件已变化，请重新读取后比较', 'conflict')
                version_id = uuid4().hex
                session.add(AppSetting(key=VERSION_PREFIX + version_id, value_json={
                    'id': version_id, 'path': path, 'root': mount['root'], 'hash': current_hash,
                    'content': original, 'createdAt': utcnow().isoformat()}))
                session.commit()
                if digest(_read_at(parent, name)) != expected_hash:
                    raise MountError('文件已变化，请重新读取后比较', 'conflict')
                os.replace(temporary, name, src_dir_fd=parent, dst_dir_fd=parent)
            else:
                # link is an atomic exclusive create; never replace a concurrently created file.
                os.link(temporary, name, src_dir_fd=parent, dst_dir_fd=parent, follow_symlinks=False)
            os.fsync(parent)
        except FileExistsError as exc:
            raise MountError('文件已由其他操作创建，请重新读取', 'conflict') from exc
        except OSError as exc:
            raise MountError('写入失败，请检查目录权限', 'bad_path') from exc
        finally:
            try:
                os.unlink(temporary, dir_fd=parent)
            except FileNotFoundError:
                pass
    return {'path': path, 'bytes': len(data), 'hash': digest(text), 'versionId': version_id}


def versions(session: Session, path: str) -> list[dict]:
    mount, _ = _parse(session, path)
    rows = session.exec(select(AppSetting).where(AppSetting.key.startswith(VERSION_PREFIX))).all()
    return sorted([{k: v for k, v in row.value_json.items() if k in {'id', 'path', 'hash', 'createdAt'}}
                   for row in rows if row.value_json.get('path') == path and row.value_json.get('root') == mount['root']],
                  key=lambda item: item['createdAt'], reverse=True)


def version_content(session: Session, path: str, version_id: str) -> dict:
    mount, _ = _parse(session, path)
    row = session.get(AppSetting, VERSION_PREFIX + version_id)
    if not row or row.value_json.get('path') != path or row.value_json.get('root') != mount['root']:
        raise MountError('文件版本不存在', 'not_found')
    return {'content': row.value_json['content'], 'hash': row.value_json['hash']}


def restore(session: Session, path: str, version_id: str, expected_hash: str) -> dict:
    mount, _ = _parse(session, path)
    row = session.get(AppSetting, VERSION_PREFIX + version_id)
    if not row or row.value_json.get('path') != path or row.value_json.get('root') != mount['root']:
        raise MountError('文件版本不存在', 'not_found')
    return write_text(session, path, row.value_json['content'], expected_hash)
