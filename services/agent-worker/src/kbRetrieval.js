/** Compact retrieval boundaries: never return upload storage URIs or full manuscripts. */
export const KB_SOURCE_SCOPES = ["methodology", "documents", "tropes", "all"];
const clip = (value, max = 600) => String(value || "").slice(0, max);

export async function searchKb(api, query, opts = {}, localFallback = () => []) {
  const sourceScope = opts.sourceScope || "methodology";
  if (!KB_SOURCE_SCOPES.includes(sourceScope)) throw new Error(`Invalid sourceScope: ${sourceScope}`);
  const limit = Math.min(40, Math.max(1, Math.floor(Number(opts.limit) || 8)));
  const errors = [];
  const groups = [];
  let mode = opts.mode || "hybrid";
  if (sourceScope === "methodology" || sourceScope === "all") {
    let rows;
    try {
      const result = await api.searchKnowledge(query, { ...opts, limit });
      rows = result.hits || [];
      mode = result.mode || mode;
    } catch {
      rows = localFallback(query, { ...opts, limit });
      mode = "local-fallback";
      errors.push({ source: "methodology", error: "remote_unavailable", fallback: "local-index" });
    }
    groups.push(rows.slice(0, limit).map((row) => ({
      id: row.id || row.path, path: row.path, title: row.title,
      category: row.category, tags: row.tags, score: row.score,
      source: "methodology", retrievalSource: row.source,
      summary: clip(row.summary), snippet: clip(row.snippet || row.summary),
      position: row.locator || row.path || row.id,
    })));
  }
  if (sourceScope !== "methodology") {
    try {
      const result = await api.searchUploadedKb(query);
      if (sourceScope === "documents" || sourceScope === "all") {
        const docs = new Map((result.docs || []).map((row) => [row.id, row]));
        const matches = result.matches || [];
        const seen = new Set(matches.map((row) => row.docId));
        const rows = [...matches, ...[...docs.values()].filter((row) => !seen.has(row.id))];
        groups.push(rows.slice(0, limit).map((row) => {
          const docId = row.docId || row.id;
          const snippets = (row.snippets || []).slice(0, 3).map((s) => ({
            text: clip(s.text), locator: s.locator || null,
          }));
          return { id: docId, docId, title: row.title || docs.get(docId)?.title,
            source: "documents", score: row.score, snippets,
            snippet: snippets[0]?.text || "", position: snippets[0]?.locator || null };
        }));
      }
      if (sourceScope === "tropes" || sourceScope === "all") {
        groups.push((result.tropes || []).slice(0, limit).map((row) => ({
          id: row.id, title: row.name, source: "tropes", docId: row.docId || row.doc_id,
          snippet: clip(row.summary), tags: row.tags, position: row.locator || null,
        })));
      }
    } catch {
      errors.push({ source: sourceScope === "all" ? "documents/tropes" : sourceScope, error: "search_unavailable" });
    }
  }
  // Interleave independent corpora; their scores are not comparable.
  const hits = [];
  for (let i = 0; i < limit && hits.length < limit; i += 1) {
    for (const group of groups) if (group[i] && hits.length < limit) hits.push(group[i]);
  }
  return { query, sourceScope, hits, count: hits.length, mode, ...(errors.length ? { errors } : {}) };
}
