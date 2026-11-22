/** Restore older JSON against the current form shape without discarding authored fields. */
function compatible(value: unknown, fallback: unknown): boolean {
  if (fallback === null) return true;
  if (Array.isArray(fallback)) return Array.isArray(value);
  if (typeof fallback === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  return typeof value === typeof fallback;
}

export function normalizePersistedState<T>(value: unknown, fallback: T): T {
  if (!compatible(value, fallback)) return fallback;
  if (Array.isArray(fallback)) {
    const items = value as unknown[];
    if (!fallback.length) return items as T;
    const shape = fallback[0];
    return items.filter(item => compatible(item, shape)).map(item => normalizePersistedState(item, shape)) as T;
  }
  if (fallback !== null && typeof fallback === 'object') {
    const restored = { ...(value as Record<string, unknown>) };
    for (const [key, initial] of Object.entries(fallback)) {
      restored[key] = normalizePersistedState(restored[key], initial);
    }
    return restored as T;
  }
  return value as T;
}

export function loadPersistedState<T>(key: string | null, fallback: T, storage?: Pick<Storage, 'getItem'>): T {
  if (!key) return fallback;
  try {
    const raw = (storage ?? localStorage).getItem(key);
    return raw ? normalizePersistedState(JSON.parse(raw), fallback) : fallback;
  } catch {
    return fallback;
  }
}
