import { createHash } from "node:crypto";

const digest = text => createHash("sha256").update(text).digest("hex");
const sensitive = /(?:token|secret|credentials|headers|auth)\s*[:=]|authorization|proxy-authenticate|cookie|passw(?:or)?d|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|(?:private|secret)[-_ ]?key|bearer\s+|(?:sk[-_]|gh[pousr]_|github_pat_|AKIA|xox[baprs]-)[a-z\d_-]{10}|eyJ[\w-]+\.[\w-]+\.|:\/\/[^/\s:@]+:[^/\s@]+@|reasoning[_ -]?(?:content|details)|<\/?think(?:ing)?>|["'](?:[\w-]*(?:token|secret|password|credential|api_key)|headers|credentials|auth)["']\s*:/i;

function preview(text, limit, privateSource = false) {
  if (privateSource || sensitive.test(text)) return { hidden: privateSource ? "私有来源" : "敏感字段", preview: "" };
  return { preview: text.slice(0, limit), clipped: text.length > limit };
}

function bounded(items, limit) {
  return items.length <= limit ? items : [...items.slice(0, limit / 2), ...items.slice(-limit / 2)];
}

function safeFields(value, field) {
  if (typeof value === "string" && field !== "preview" && (sensitive.test(value) || value.length > 320))
    return "sha256:" + digest(value);
  if (Array.isArray(value)) return value.map(item => safeFields(item, field));
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, safeFields(item, key)]));
  return value;
}

export function messageIdentities() {
  return { ids: new WeakMap(), occurrences: new Map() };
}

function describe(messages, identities) {
  return messages.map(m => {
    const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
    const text = m.content == null ? "" : content;
    const calls = m.tool_calls?.length ? JSON.stringify(m.tool_calls) : "";
    const hash = digest(text);
    const key = digest(JSON.stringify([m.role, hash, m.name, m.tool_call_id, calls]));
    let id = m.tool_call_id || identities.ids.get(m);
    if (!id) {
      const n = (identities.occurrences.get(key) || 0) + 1;
      identities.occurrences.set(key, n);
      id = key.slice(0, 16) + "-" + n;
      identities.ids.set(m, id);
    }
    return { message: m, id, hash, chars: text.length + calls.length, text };
  });
}

// A projection of the final public message fields. Native reasoning stays in the
// execution history. The provider never receives these rows or provenance.
export function contextManifest({ messages, original = messages, tools = [], mode = "normal", slots = [], sources = {}, references = [], taskPrompt, identities = messageIdentities() }) {
  const before = describe(original, identities);
  const after = original === messages ? before : describe(messages, identities);
  const byId = new Map(after.map(row => [row.id, row]));
  const receipts = new Set(messages.flatMap(m => [m.tool_call_id, ...(m.compactionEvidence || []).map(r => r.tool_call_id)]).filter(Boolean));
  const archived = new Set();
  const changes = [];
  for (const row of before) {
    const kept = byId.get(row.id);
    if (kept?.hash === row.hash) continue;
    const m = row.message;
    for (const id of [m.tool_call_id, ...(m.compactionEvidence || []).map(r => r.tool_call_id)]) {
      if (id && !receipts.has(id) && !byId.has(id)) archived.add(id);
    }
    changes.push({ id: row.id, role: m.role, status: kept ? "clipped" : archived.has(row.id) ? "archived" : "summarized" });
  }
  const rows = bounded(after, 32).map(({ message: m, text, id, hash, chars }) => {
    const memo = Array.isArray(m.compactionEvidence);
    const source = memo ? (mode === "handoff" || text.startsWith("## Handoff") ? "handoff" : "summary") : m.name || m.role;
    return { id, hash, role: m.role, source, chars, status: "included",
      ...(m.role === "system" && slots.length ? { hidden: "按槽位展示", preview: "" } : preview(text, memo ? 2400 : 160, /\/memories\/(?:bots\/|.*\/procedural\/)/.test(text))),
      ...(m.tool_calls?.length ? { callIds: bounded(m.tool_calls.map(c => c.id), 16), callNames: bounded(m.tool_calls.map(c => c.function?.name), 16), callsHash: digest(JSON.stringify(m.tool_calls)) } : {}) };
  });
  const exactRefs = taskPrompt && messages.some(m => m.role === "user" && m.content === taskPrompt) ? references : [];
  return safeFields({ schema: 1, mode, count: messages.length, omitted: after.length - rows.length,
    originalChars: before.reduce((n, r) => n + r.chars, 0), sentChars: after.reduce((n, r) => n + r.chars, 0),
    rows, tools: tools.map(t => t.function.name),
    toolOrderHash: digest(JSON.stringify(tools.map(t => t.function.name))),
    toolSchemaHash: digest(JSON.stringify(tools)),
    slots: slots.map(s => ({ source: s.id, hash: s.hash, chars: s.chars, ...sources[s.id], ...preview(s.text, 120, s.id === "lessons" || s.id === "personalization"), truncated: s.truncated })),
    references: exactRefs.slice(0, 8).map(({ id, kind, projectId, sourceId, snapshotId, contentHash, version, start, end, quote }) =>
      ({ id, kind, projectId, sourceId, snapshotId, contentHash, version, start, end, ...preview(String(quote || ""), 160) })),
    changes: bounded(changes, 48), omittedChanges: Math.max(0, changes.length - 48),
    receipts: bounded([...receipts], 48), omittedReceipts: Math.max(0, receipts.size - 48),
    archived: bounded([...archived], 48), omittedArchived: Math.max(0, archived.size - 48),
    excluded: "其他岗位私有记忆不在本次挂载范围" });
}
