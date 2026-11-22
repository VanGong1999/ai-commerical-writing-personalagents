"""虚拟文件系统：路径逃逸 / edit 唯一匹配 / 只读挂载。"""

from __future__ import annotations

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app import vfs
from app.models import MemoryFile
from app.seed import DEMO_USER

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
SQLModel.metadata.create_all(engine)


def test_root_ls():
    with Session(engine) as session:
        entries = vfs.ls(session, "/")
        names = {e["name"] for e in entries}
        assert names == {"memories", "projects", "kb", "workspace", "runs", "threads", "inbox"}


def test_memories_write_read_edit():
    with Session(engine) as session:
        path = "/memories/user/instructions.md"
        vfs.write(session, path, "第一条规则\n", actor="test")
        data = vfs.read(session, path)
        assert "第一条规则" in data["raw"]
        vfs.edit(session, path, "第一条规则", "更新后的规则", actor="test")
        data2 = vfs.read(session, path)
        assert "更新后的规则" in data2["raw"]


def test_edit_ambiguous_requires_replace_all():
    with Session(engine) as session:
        path = "/memories/user/note.md"
        vfs.write(session, path, "aaa aaa aaa", actor="test")
        with pytest.raises(vfs.VfsError) as ei:
            vfs.edit(session, path, "aaa", "b", actor="test")
        assert ei.value.code == "ambiguous"
        out = vfs.edit(session, path, "aaa", "b", replace_all=True, actor="test")
        assert out["path"] == path


def test_chief_memories_only():
    with Session(engine) as session:
        with pytest.raises(vfs.VfsError) as ei:
            vfs.write(
                session,
                "/workspace/hack.txt",
                "x",
                actor="chief",
                allow_memories_only=True,
            )
        assert ei.value.code == "forbidden"


def test_workspace_path_escape():
    with pytest.raises(vfs.VfsError) as ei:
        vfs._workspace_resolve("/workspace/../../etc/passwd")
    assert ei.value.code == "path_escape"


def test_kb_readonly():
    with Session(engine) as session:
        with pytest.raises(vfs.VfsError) as ei:
            vfs.write(session, "/kb/foo.md", "x", actor="test")
        assert ei.value.code == "readonly"


def test_grep_find():
    with Session(engine) as session:
        session.add(
            MemoryFile(
                path="/memories/user/index.md",
                user_id=DEMO_USER,
                content="hello persona 节奏编排师",
            )
        )
        session.commit()
        hits = vfs.grep(session, "节奏", "/memories")
        assert hits
        paths = vfs.find(session, "/memories", glob_pat="*.md")
        assert any(p.endswith("index.md") for p in paths)
