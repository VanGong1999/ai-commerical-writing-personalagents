import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  emptyStoryGraph,
  mergeEpisodeIntoStory,
  overdueForeshadows,
  parseForeshadowLedger,
  sliceStoryGraphForBible,
  storyGraphToMermaid,
  validateStoryGraphConsistency,
  withGeneratedMermaid,
} from "./story-graph.ts";

describe("story-graph", () => {
  it("generates mermaid from nodes/edges", () => {
    const g = withGeneratedMermaid({
      ...emptyStoryGraph("story_graph"),
      nodes: [
        { id: "c1", kind: "character", label: "主角", episodeSpan: { from: 1 }, status: "active" },
        { id: "e1", kind: "event", label: "被陷害", episodeSpan: { from: 1 }, status: "active" },
      ],
      edges: [
        {
          from: "e1",
          to: "c1",
          kind: "causes",
          episode: 1,
          open: false,
        },
      ],
    });
    const m = storyGraphToMermaid(g);
    assert.match(m, /flowchart TD/);
    assert.match(m, /主角/);
    assert.match(m, /导致/);
  });

  it("flags dangling edges and location conflicts", () => {
    const issues = validateStoryGraphConsistency({
      ...emptyStoryGraph("episode_graph", 2),
      nodes: [{ id: "a", kind: "character", label: "A", episodeSpan: { from: 2 }, status: "active" }],
      edges: [{ from: "a", to: "missing", kind: "knows", episode: 2, open: true }],
      characterStates: [
        {
          characterId: "a",
          name: "A",
          episode: 2,
          location: "京城",
          inventory: [],
          knownFacts: [],
          powerLevel: "",
          emotion: "",
        },
        {
          characterId: "a",
          name: "A",
          episode: 2,
          location: "江南",
          inventory: [],
          knownFacts: [],
          powerLevel: "",
          emotion: "",
        },
      ],
    });
    assert.ok(issues.some((i) => i.code === "dangling_edge"));
    assert.ok(issues.some((i) => i.code === "location_conflict" && i.severity === "warn"));
  });

  it("merges episode into story and slices for bible", () => {
    const story = emptyStoryGraph("story_graph");
    const ep = withGeneratedMermaid({
      ...emptyStoryGraph("episode_graph", 3),
      nodes: [
        { id: "c1", kind: "character", label: "主角", episodeSpan: { from: 3 }, status: "active" },
      ],
      edges: [],
      characterStates: [
        {
          characterId: "c1",
          name: "主角",
          episode: 3,
          location: "客栈",
          inventory: ["令牌"],
          knownFacts: [],
          powerLevel: "初阶",
          emotion: "怒",
        },
      ],
    });
    const merged = mergeEpisodeIntoStory(story, ep);
    assert.equal(merged.nodes.length, 1);
    const slice = sliceStoryGraphForBible(merged, { currentEp: 3, recentEps: 3 });
    assert.match(slice, /主角/);
    assert.match(slice, /客栈/);
  });

  it("detects overdue foreshadows", () => {
    const ledger = parseForeshadowLedger({
      schemaVersion: "foreshadow-ledger/1",
      entries: [
        { id: "F1", plantEp: 1, dueEp: 3, text: "令牌下落", status: "open" },
      ],
    });
    assert.equal(overdueForeshadows(ledger, 4).length, 1);
    assert.equal(overdueForeshadows(ledger, 3).length, 0);
  });
});
