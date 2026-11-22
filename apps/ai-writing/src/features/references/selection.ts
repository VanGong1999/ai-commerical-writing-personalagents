/** Browser offsets are UTF-16 code units; the API uses the same explicit convention. */
export type ContextRef = {
  id?: string;
  kind: "artifact" | "kb_doc" | "report" | "draft" | "file";
  sourceId: string;
  projectId?: string;
  version?: number;
  start?: number;
  end?: number;
  quote?: string;
  title?: string;
  draftText?: string;
  snapshotId?: string;
  contentHash?: string;
  contextBefore?: string;
  contextAfter?: string;
};

function splitsSurrogate(text: string, pos: number): boolean {
  return pos > 0 && pos < text.length && /[\uD800-\uDBFF]/.test(text[pos - 1]) && /[\uDC00-\uDFFF]/.test(text[pos]);
}

export function selectionRequest(source: ContextRef, text: string, start: number, end: number): ContextRef {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > text.length || start >= end || splitsSurrogate(text, start) || splitsSurrogate(text, end)) {
    throw new Error("请选择完整且非空的文本片段");
  }
  if (end - start > 4000) throw new Error("单个片段最多引用 4000 字符，请缩小选区");
  return { ...source, start, end, quote: text.slice(start, end), draftText: text };
}

/** Never apply a late model result to a different file or a changed local draft. */
export function applySelectionEdit(sourceId: string, currentText: string, ref: ContextRef, replacement: string): string {
  if (sourceId !== ref.sourceId) throw new Error("已切换文件，请回到原稿后再采纳");
  if (ref.draftText !== undefined && currentText !== ref.draftText) throw new Error("原稿已修改，请比较差异后重新选择段落");
  if (ref.start === undefined || ref.end === undefined || currentText.slice(ref.start, ref.end) !== ref.quote) throw new Error("原选区已变化，请重新引用");
  return currentText.slice(0, ref.start) + replacement + currentText.slice(ref.end);
}

export function sameReference(a: ContextRef, b: ContextRef): boolean {
  return a.kind === b.kind && a.sourceId === b.sourceId && a.version === b.version && a.start === b.start && a.end === b.end && a.quote === b.quote && a.snapshotId === b.snapshotId && a.draftText === b.draftText && a.contentHash === b.contentHash;
}

export type ReferenceIntent = { refs: ContextRef[]; prompt?: string };
export const REFERENCE_EVENT = "xzm:reference-assistant";
export const APPLY_REFERENCE_EVENT = "xzm:apply-reference";
export function askWithReference(ref: ContextRef, prompt?: string) {
  window.dispatchEvent(new CustomEvent<ReferenceIntent>(REFERENCE_EVENT, { detail: { refs: [ref], prompt } }));
}

export function mergeReferences(existing: ContextRef[], incoming: ContextRef[]): ContextRef[] {
  const out = [...existing];
  for (const ref of incoming) if (!out.some(r => sameReference(r,ref))) out.push(ref);
  return out;
}
