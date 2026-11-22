"""最小 RBAC/OU 策略：为记忆读写提供角色级访问控制，默认 admin。

本地单用户定稿：默认 admin 全放行；X-User-Role 可被客户端伪造，勿当公网鉴权。
企业 OU / 多租户 RBAC 已放弃（BACKLOG phase 021），本模块仅作兼容桩。
"""
from __future__ import annotations

from fastapi import HTTPException

ROLE_RANK = {"viewer": 1, "writer": 2, "admin": 3}


def _project_from_path(path: str) -> str | None:
    parts = (path or "").strip("/").split("/")
    if len(parts) >= 3 and parts[0] == "memories" and parts[1] == "projects":
        return parts[2]
    return None


def require_memory_access(
    role: str,
    path: str,
    action: str,
    *,
    project_id: str | None = None,
    own_ou: str | None = None,
) -> None:
    """校验记忆访问；admin 全放行，writer/viewer 仅限本项目（OU 维度可再收紧）。"""
    role = role or "admin"
    if role not in ROLE_RANK:
        raise HTTPException(403, f"未知角色：{role}")
    if role == "admin":
        return

    if action == "write" and role not in ("writer", "admin"):
        raise HTTPException(403, f"角色 {role} 无写入权限")

    proj = _project_from_path(path)
    if proj and project_id and proj != project_id:
        raise HTTPException(403, "跨项目记忆访问被拒绝")
    if own_ou and not path.startswith(f"/memories/ou/{own_ou}/"):
        raise HTTPException(403, "跨 OU 记忆访问被拒绝")
