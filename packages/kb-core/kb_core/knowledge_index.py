"""Local keyword search over knowledge/00-meta/search-index.json (no vectors)."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

# packages/kb-core/kb_core → repo root
_REPO_ROOT = Path(__file__).resolve().parents[3]
_DEFAULT_INDEX = _REPO_ROOT / "knowledge" / "00-meta" / "search-index.json"

_TOKEN_RE = re.compile(r"[\w\u4e00-\u9fff]+", re.UNICODE)


@dataclass(frozen=True)
class KnowledgeHit:
    id: str
    path: str
    title: str
    category: str
    tags: tuple[str, ...]
    authority: str
    related_skills: tuple[str, ...]
    related_agents: tuple[str, ...]
    summary: str
    score: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "path": self.path,
            "title": self.title,
            "category": self.category,
            "tags": list(self.tags),
            "authority": self.authority,
            "relatedSkills": list(self.related_skills),
            "relatedAgents": list(self.related_agents),
            "summary": self.summary,
            "score": self.score,
        }


def _tokenize(text: str) -> list[str]:
    return [t.lower() for t in _TOKEN_RE.findall(text or "") if t.strip()]


def _resolve_index_path(index_path: str | Path | None) -> Path:
    if index_path is None:
        return _DEFAULT_INDEX
    return Path(index_path)


@lru_cache(maxsize=4)
def _load_raw(index_path_str: str) -> tuple[dict[str, Any], ...]:
    path = Path(index_path_str)
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict) and "articles" in data:
        articles = data["articles"]
    elif isinstance(data, list):
        articles = data
    else:
        raise ValueError("search-index.json must be a list or {articles: [...]}")
    return tuple(articles)


def load_knowledge_index(
    index_path: str | Path | None = None,
    *,
    reload: bool = False,
) -> list[dict[str, Any]]:
    """Load article metadata from search-index.json (no article body)."""
    path = _resolve_index_path(index_path)
    if reload:
        _load_raw.cache_clear()
    return [dict(a) for a in _load_raw(str(path.resolve()))]


# Aliases matching the TS-oriented task names
loadKnowledgeIndex = load_knowledge_index


def _score_article(article: dict[str, Any], query_tokens: list[str]) -> float:
    if not query_tokens:
        return 0.0
    title = str(article.get("title") or "")
    summary = str(article.get("summary") or "")
    tags = [str(t) for t in (article.get("tags") or [])]
    category = str(article.get("category") or "")
    path = str(article.get("path") or "")
    blob_id = str(article.get("id") or "")

    title_l = title.lower()
    summary_l = summary.lower()
    tags_l = " ".join(tags).lower()
    cat_l = category.lower()
    path_l = path.lower()
    id_l = blob_id.lower()

    score = 0.0
    for tok in query_tokens:
        if tok in title_l:
            score += 5.0
            if title_l.startswith(tok) or f" {tok}" in f" {title_l}":
                score += 1.0
        if any(tok in t.lower() for t in tags):
            score += 3.0
        if tok in tags_l:
            score += 0.5
        if tok in summary_l:
            score += 2.0
        if tok in cat_l or tok in path_l or tok in id_l:
            score += 1.0
    # phrase bonus: full query as substring of title
    q = "".join(query_tokens)
    if len(q) >= 2 and q in title_l.replace(" ", ""):
        score += 2.0
    return score


def search_knowledge(
    query: str,
    opts: dict[str, Any] | None = None,
    *,
    index_path: str | Path | None = None,
) -> list[KnowledgeHit]:
    """Keyword / title / tags scoring search. opts: category?, limit? (default 10)."""
    opts = opts or {}
    category = opts.get("category")
    limit = int(opts.get("limit") or 10)
    articles = load_knowledge_index(index_path)
    tokens = _tokenize(query)
    hits: list[KnowledgeHit] = []
    for a in articles:
        if category and str(a.get("category") or "") != str(category):
            continue
        score = _score_article(a, tokens) if tokens else 0.0
        if tokens and score <= 0:
            continue
        if not tokens:
            score = 0.0
        hits.append(
            KnowledgeHit(
                id=str(a.get("id") or ""),
                path=str(a.get("path") or ""),
                title=str(a.get("title") or ""),
                category=str(a.get("category") or ""),
                tags=tuple(str(t) for t in (a.get("tags") or [])),
                authority=str(a.get("authority") or ""),
                related_skills=tuple(str(t) for t in (a.get("relatedSkills") or [])),
                related_agents=tuple(str(t) for t in (a.get("relatedAgents") or [])),
                summary=str(a.get("summary") or ""),
                score=score,
            )
        )
    hits.sort(key=lambda h: (-h.score, h.path))
    if not tokens:
        return hits[:limit]
    return [h for h in hits if h.score > 0][:limit]


searchKnowledge = search_knowledge
