import { createHash } from "node:crypto";

/** Canonical JSON: recursively sorted keys and compact encoding, matching the API. */
export function contentHash(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item !== null && typeof item === 'object') {
      return Object.fromEntries(Object.keys(item).sort().map(key => [key, canonical((item as Record<string, unknown>)[key])]));
    }
    return item;
  };
  return createHash("sha256").update(JSON.stringify(canonical(value ?? null))).digest("hex");
}
