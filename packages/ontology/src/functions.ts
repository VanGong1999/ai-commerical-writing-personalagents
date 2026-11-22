import {
  mergeEpisodeIntoStory,
  overdueForeshadows,
  openForeshadows,
  parseForeshadowLedger,
  sliceStoryGraphForBible,
  storyGraphToMermaid,
  validateStoryGraphConsistency,
  withGeneratedMermaid,
  type ForeshadowLedger,
  type StoryGraphBody,
} from "@xiezuomanju/domain/story-graph";
import { contentHash } from "./hash.ts";

export type ObjectRecord = {
  rid: string;
  typeApiName: string;
  projectId: string;
  properties: Record<string, unknown>;
  contentHash: string;
  version: number;
  status: string;
};

export function fnContentHash(value: unknown): string {
  return contentHash(value);
}

export function fnMergeEpisodeIntoStory(story: StoryGraphBody, episode: StoryGraphBody) {
  return mergeEpisodeIntoStory(story, episode);
}

export function fnStoryGraphToMermaid(graph: StoryGraphBody) {
  return storyGraphToMermaid(graph);
}

export function fnWithGeneratedMermaid(graph: StoryGraphBody) {
  return withGeneratedMermaid(graph);
}

export function fnValidateStoryGraphConsistency(
  graph: StoryGraphBody | null | undefined,
  opts?: Parameters<typeof validateStoryGraphConsistency>[1],
) {
  return validateStoryGraphConsistency(graph, opts);
}

export function fnSliceForBible(
  graph: StoryGraphBody | null | undefined,
  opts?: Parameters<typeof sliceStoryGraphForBible>[1],
) {
  return sliceStoryGraphForBible(graph, opts);
}

export function fnOpenPayoffs(ledgerRaw: unknown) {
  const ledger = parseForeshadowLedger(ledgerRaw);
  return openForeshadows(ledger);
}

export function fnOverdueForeshadows(ledgerRaw: unknown, currentEp: number) {
  const ledger = parseForeshadowLedger(ledgerRaw) as ForeshadowLedger;
  return overdueForeshadows(ledger, currentEp);
}

export function fnObjectSet(
  objects: ObjectRecord[],
  opts: { typeApiName?: string; projectId?: string; status?: string },
): ObjectRecord[] {
  return objects.filter((o) => {
    if (opts.projectId && o.projectId !== opts.projectId) return false;
    if (opts.typeApiName && o.typeApiName !== opts.typeApiName) return false;
    if (opts.status && o.status !== opts.status) return false;
    return true;
  });
}

export function fnSearchAround(
  links: { fromRid: string; toRid: string; linkType: string }[],
  rid: string,
  opts: { linkTypes?: string[]; depth?: number } = {},
): { rid: string; via: string; depth: number }[] {
  const depth = opts.depth ?? 1;
  const allow = opts.linkTypes ? new Set(opts.linkTypes) : null;
  const out: { rid: string; via: string; depth: number }[] = [];
  let frontier = new Set([rid]);
  const seen = new Set([rid]);
  for (let d = 1; d <= depth; d++) {
    const next = new Set<string>();
    for (const L of links) {
      if (allow && !allow.has(L.linkType)) continue;
      if (frontier.has(L.fromRid) && !seen.has(L.toRid)) {
        seen.add(L.toRid);
        next.add(L.toRid);
        out.push({ rid: L.toRid, via: L.linkType, depth: d });
      }
      if (frontier.has(L.toRid) && !seen.has(L.fromRid)) {
        seen.add(L.fromRid);
        next.add(L.fromRid);
        out.push({ rid: L.fromRid, via: L.linkType, depth: d });
      }
    }
    frontier = next;
  }
  return out;
}

export function fnRenderStoryContinuityView(graph: StoryGraphBody | null | undefined) {
  if (!graph) return { mermaid: "flowchart TD\n  empty([暂无节点])", nodeCount: 0, edgeCount: 0 };
  const body = withGeneratedMermaid(graph);
  return {
    mermaid: body.mermaid,
    nodeCount: body.nodes.length,
    edgeCount: body.edges.length,
    openQuestions: body.openQuestions,
    contradictions: body.contradictions,
  };
}
