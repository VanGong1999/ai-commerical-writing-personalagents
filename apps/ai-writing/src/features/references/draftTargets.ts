import type { ContextRef } from "./selection";

type Target = (ref: ContextRef, text: string, insert: boolean) => Promise<void>;
const targets = new Map<string, Target>();
export function registerDraftTarget(sourceId: string, target: Target) {
  targets.set(sourceId, target);
  return () => { if (targets.get(sourceId) === target) targets.delete(sourceId); };
}
export function draftTarget(sourceId: string) { return targets.get(sourceId); }
export async function textHash(text: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2,"0")).join("");
}
