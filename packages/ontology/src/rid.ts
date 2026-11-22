/** Resource ID：ri.writing.{typeApiName}.{uuid} */

const RID_RE = /^ri\.writing\.([a-z][a-z0-9_]*)\.([0-9a-f-]{8,})$/i;

export function makeRid(typeApiName: string, id?: string): string {
  const uuid =
    id ||
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`);
  return `ri.writing.${typeApiName}.${uuid}`;
}

export function parseRid(rid: string): { typeApiName: string; id: string } | null {
  const m = RID_RE.exec(rid);
  if (!m) return null;
  return { typeApiName: m[1], id: m[2] };
}

export function isRid(value: string): boolean {
  return RID_RE.test(value);
}
