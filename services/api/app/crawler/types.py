from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class RankItem:
    rank: int
    title: str
    author: str = ""
    genre: str = ""
    abstract: str = ""
    status: str = ""  # 连载/完结
    url: str = ""
    book_id: str = ""
    tags: list[str] = field(default_factory=list)
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class FetchResult:
    source_id: str
    platform: str
    board_name: str
    items: list[RankItem]
    needs_cookie: bool = False
    cookie_hint: str = ""
    error: str | None = None
    raw_note: str = ""

    @property
    def ok(self) -> bool:
        return self.error is None and len(self.items) > 0
