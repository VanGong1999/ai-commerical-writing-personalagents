export function manuscriptAccess(status: "error" | "pending" | "success") {
  if (status === "error") return "retry";
  return status === "success" ? "edit" : "loading";
}

export function manuscriptSourceId(projectId?: string, artifactId?: string) {
  return artifactId ?? `draft:manuscript:${projectId ?? "local"}:1`;
}

export function restoreSynopsis(localValue: string | null, projectValue: string) {
  return localValue ?? projectValue;
}

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type LocalDraft = {text: string; version?: number};
function manuscriptKey(project: string, source: string) {
  return JSON.stringify(["studio-manuscript", project, source]);
}
export function readManuscriptDraft(storage: DraftStorage, project: string, source: string): LocalDraft | null {
  try {
    const raw = storage.getItem(manuscriptKey(project, source));
    const saved = raw && JSON.parse(raw);
    if (!saved || typeof saved.text !== "string") return null;
    if (saved.version !== undefined && !Number.isSafeInteger(saved.version)) return null;
    return saved;
  } catch { return null; }
}
export function writeManuscriptDraft(storage: DraftStorage, project: string, source: string, draft: LocalDraft) {
  try {
    storage.setItem(manuscriptKey(project, source), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}
export function clearSavedDraft(storage: DraftStorage, project: string, source: string, savedText: string) {
  if (readManuscriptDraft(storage, project, source)?.text !== savedText) return;
  try { storage.removeItem(manuscriptKey(project, source)); } catch { /* retain recovered draft */ }
}

export function firstManuscriptKey(projectId: string | undefined, sourceId: string) {
  return ["first-manuscript", projectId, sourceId] as const;
}

export function reconcileFirstManuscript(storage: DraftStorage, project: string, temporarySource: string, submitted: string, artifactId: string, version: number) {
  const local = readManuscriptDraft(storage, project, temporarySource);
  if (!local) return true;
  if (local.text !== submitted) {
    const written = writeManuscriptDraft(storage, project, artifactId, {text:local.text, version});
    if (!written) return false;
  }
  clearSavedDraft(storage, project, temporarySource, local.text);
  return true;
}

// A save may finish after its initiating editor has unmounted.
type ReconcileDraft = (draft: LocalDraft | null) => LocalDraft | null;
type SaveListener = (reconcile: ReconcileDraft) => void;
const saveListeners = new Map<string, Set<SaveListener>>();

export function observeDraftSave(project: string, source: string, listener: SaveListener) {
  const key = manuscriptKey(project, source);
  const listeners = saveListeners.get(key) ?? new Set<SaveListener>();
  listeners.add(listener);
  saveListeners.set(key, listeners);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) saveListeners.delete(key);
  };
}

export function finishDraftSave(storage: DraftStorage, project: string, source: string, submitted: LocalDraft, version: number) {
  const reconcile: ReconcileDraft = draft => {
    if (!draft || draft.version !== submitted.version) return draft;
    return draft.text === submitted.text ? null : { ...draft, version };
  };
  const saved = readManuscriptDraft(storage, project, source);
  const next = reconcile(saved);
  if (saved && saved !== next) {
    if (next) writeManuscriptDraft(storage, project, source, next);
    else clearSavedDraft(storage, project, source, saved.text);
  }
  saveListeners.get(manuscriptKey(project, source))?.forEach(listener => listener(reconcile));
}
