import { Button, toast } from "@xiezuomanju/ui";
import { askWithReference, selectionRequest, type ContextRef } from "./selection";

export function SelectionActions({ source, text, range }: { source: ContextRef; text: string; range: {start:number;end:number} | null }) {
  if (!range || range.end <= range.start) return null;
  const ask = (prompt?: string) => {
    try {
      const ref = selectionRequest(source, text, range.start, range.end);
      if (ref.kind !== "draft") delete ref.draftText;
      askWithReference(ref,prompt);
    }
    catch (e) { toast.info(e instanceof Error ? e.message : "请重新选择片段"); }
  };
  return <div className="selection-actions" role="toolbar" aria-label="选中文字操作">
    <span className="muted">已选 {range.end - range.start} 字符</span>
    <Button size="sm" variant="ghost" onClick={() => ask()}>@ 引用给助手</Button>
    <Button size="sm" onClick={() => ask("请优化所引用的段落，保留情节事实、人物声口与有意义的表达。给出可替换的正文，修改说明另列。")}>优化这段</Button>
    <Button size="sm" variant="ghost" onClick={() => ask("请总结引用片段中的情节、人物动机和冲突，只分析，不修改原稿。")}>总结情节</Button>
  </div>;
}

/** Map a rendered source span back to source offsets, excluding gutters and annotations. */
export function sourceSelection(root: HTMLElement): {start:number;end:number} | null {
  const selected = window.getSelection();
  if (!selected || selected.isCollapsed || !selected.rangeCount) return null;
  const range = selected.getRangeAt(0);
  const point = (node: Node, offset: number) => {
    const el = (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement)?.closest<HTMLElement>("[data-source-start]");
    if (!el || !root.contains(el)) return null;
    const prefix = document.createRange(); prefix.selectNodeContents(el); prefix.setEnd(node,offset);
    return Number(el.dataset.sourceStart) + prefix.toString().length;
  };
  const start = point(range.startContainer,range.startOffset), end = point(range.endContainer,range.endOffset);
  return start !== null && end !== null && end > start ? {start,end} : null;
}
