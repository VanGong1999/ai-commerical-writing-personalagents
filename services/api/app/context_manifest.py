"""Bounded inspection of the public fields in an assembled provider request."""
import hashlib
import json
import re

_SENSITIVE = re.compile(
    r"(?:token|secret|credentials|headers|auth)\s*[:=]|authorization|cookie|passw(?:or)?d|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|"
    r"client[-_ ]?secret|(?:private|secret)[-_ ]?key|bearer\s+|(?:sk[-_]|gh[pousr]_|github_pat_|AKIA|xox[baprs]-)[\w-]{10}|"
    r"eyJ[\w-]+\.[\w-]+\.|://[^/\s:@]+:[^/\s@]+@|reasoning[_ -]?(?:content|details)|"
    r"<\/?think(?:ing)?>|[\"'](?:[\w-]*(?:token|secret|password|credential|api_key)|headers|credentials|auth)[\"']\s*:", re.I)


def _hash(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _preview(text, limit, private=False):
    if private or _SENSITIVE.search(text):
        return {"preview": "", "hidden": "私有来源" if private else "敏感字段"}
    return {"preview": text[:limit], "clipped": len(text) > limit}


def _bounded(rows, limit):
    return rows if len(rows) <= limit else rows[:limit // 2] + rows[-limit // 2:]


def _safe_fields(value, field=None):
    if isinstance(value, str) and field != "preview" and (len(value) > 320 or _SENSITIVE.search(value)):
        return "sha256:" + _hash(value)
    if isinstance(value, list):
        return [_safe_fields(item, field) for item in value]
    if isinstance(value, dict):
        return {key: _safe_fields(item, key) for key, item in value.items()}
    return value


def context_manifest(messages, original, tools, sections, memory_sources, *, discussion=False):
    """original is the authorized, repaired history immediately before compaction."""
    def identify(items):
        counts = {}
        for m in items:
            text = m.get("content") or ""
            calls = json.dumps(m["tool_calls"], ensure_ascii=False, separators=(",", ":")) if m.get("tool_calls") else ""
            key = _hash(json.dumps([m["role"], _hash(text), m.get("name"), m.get("tool_call_id"), calls]))[:16]
            counts[key] = counts.get(key, 0) + 1
            identity = getattr(m, "message_id", None) or m.get("tool_call_id") or f"{key}-{counts[key]}"
            yield identity, m, text, len(text) + len(calls)

    before = list(identify([messages[0], *original]))
    sent = list(identify(messages))
    kept = {key: text for key, _, text, _ in sent}
    rows, changes, references, receipts = [], [], [], []
    summary = next((m for _, m, _, _ in sent if hasattr(m, "summarized")), None)
    summarized = getattr(summary, "summarized", set())
    for key, m, text, _ in before:
        if kept.get(key) != text:
            status = "clipped" if key in kept else "summarized" if key in summarized else "removed"
            changes.append({"id": key, "role": m["role"], "status": status, "receipt": m.get("tool_call_id")})
    for key, m, text, size in _bounded(sent, 32):
        is_summary = m is summary
        excerpt = (getattr(m, "note", None) or {}).get("message") or text
        calls = m.get("tool_calls") or []
        rows.append({"id": key, "role": m["role"], "source": "summary" if is_summary else m.get("name") or m["role"],
                     "hash": _hash(text), "chars": size, "status": "included",
                     "callIds": [c.get("id") for c in _bounded(calls, 16)],
                     **({"callNames": [(c.get("function") or {}).get("name") for c in _bounded(calls, 16)],
                         "callsHash": _hash(json.dumps(calls, separators=(",", ":"), ensure_ascii=False))} if calls else {}),
                     **_preview(excerpt, 2400 if is_summary else 160, m["role"] == "system" or "/memories/bots/" in text or "/procedural/" in text)})
    for _, m, _, _ in sent:
        if m.get("tool_call_id"):
            receipts.append(m["tool_call_id"])
        if m is summary:
            receipts.extend(m.receipts)
            references.extend(m.references)
        references.extend((getattr(m, "note", None) or {}).get("references") or [])
    # Source records are built only by the assembly functions that read these bytes.
    slots = [{"source": s["name"], "hash": _hash(s["text"]), "chars": len(s["text"]),
              **_preview(s["text"], 120, s["name"] in {"facts", "user_preferences"})} for s in sections]
    return _safe_fields({"schema": 1, "mode": "discussion" if discussion else "compaction" if changes else "normal",
            "rows": rows, "count": len(sent), "omitted": len(sent) - len(rows),
            "originalChars": sum(r[3] for r in before), "sentChars": sum(r[3] for r in sent),
            "tools": [t["function"]["name"] for t in tools or []], "slots": slots + memory_sources,
            "changes": _bounded(changes, 48), "omittedChanges": max(0, len(changes) - 48),
            "references": _bounded(references, 16), "omittedReferences": max(0, len(references) - 16),
            "receipts": _bounded(receipts, 48), "omittedReceipts": max(0, len(receipts) - 48),
            "excluded": "讨论仅使用当前交接与岗位身份" if discussion else "仅载入当前会话，其他岗位私有记忆不在范围内"})


def section_source(name, text):
    return {"source": name, "hash": _hash(text), "chars": len(text), **_preview(text, 160)}


def memory_source(metadata, label, content, included):
    return {"source": label, "path": metadata["path"], "hash": metadata["hash"], "version": metadata["updated_at"],
            "status": "included" if included else "metadata_only", "chars": len(content) if included else 0,
            **_preview(content if included else "", 120, "私有" in label)}
