import { storyGraphToMarkdown, withGeneratedMermaid, type StoryGraphBody } from "@xiezuomanju/domain/story-graph";
import { ACTION_ONLY_ARTIFACT_TYPES, OBJECT_TYPES } from "./catalog.ts";
import { artifactTypeToObjectApiName } from "./registry.ts";

export type MaterializeTarget = {
  artifactType?: string;
  title: string;
  bodyMarkdown: string;
  bodyJson: Record<string, unknown>;
  memoryPath?: string;
  memoryMarkdown?: string;
};

export function materializeObject(opts: {
  typeApiName: string;
  properties: Record<string, unknown>;
  title?: string;
}): MaterializeTarget {
  const { typeApiName, properties } = opts;
  const title = opts.title || String(properties.label || properties.title || typeApiName);

  if (typeApiName === "StoryGraph" || typeApiName === "EpisodeGraph") {
    const graph = withGeneratedMermaid({
      kind: typeApiName === "EpisodeGraph" ? "episode_graph" : "story_graph",
      schemaVersion: "story-graph/1",
      nodes: (properties.nodes as StoryGraphBody["nodes"]) || [],
      edges: (properties.edges as StoryGraphBody["edges"]) || [],
      characterStates: (properties.characterStates as StoryGraphBody["characterStates"]) || [],
      openQuestions: (properties.openQuestions as string[]) || [],
      contradictions: (properties.contradictions as string[]) || [],
      mermaid: "",
      episodeNo: properties.episodeNo as number | undefined,
    });
    return {
      artifactType: typeApiName === "EpisodeGraph" ? "episode_graph" : "story_graph",
      title,
      bodyMarkdown: storyGraphToMarkdown(graph, typeApiName),
      bodyJson: graph as unknown as Record<string, unknown>,
      memoryPath: typeApiName === "StoryGraph" ? "bible/story_graph.md" : undefined,
      memoryMarkdown: typeApiName === "StoryGraph" ? storyGraphToMarkdown(graph, "story_graph") : undefined,
    };
  }

  const artifactType =
    (properties.artifactType as string | undefined) ||
    reverseArtifact(typeApiName) ||
    undefined;

  return {
    artifactType,
    title,
    bodyMarkdown:
      typeof properties.bodyMarkdown === "string"
        ? properties.bodyMarkdown
        : `# ${title}\n\n\`\`\`json\n${JSON.stringify(properties, null, 2)}\n\`\`\`\n`,
    bodyJson: properties,
  };
}

function reverseArtifact(typeApiName: string): string | undefined {
  return OBJECT_TYPES.find((o) => o.apiName === typeApiName)?.artifactType;
}

export function isCutoverBlockedArtifactWrite(artifactType: string, viaAction: boolean): boolean {
  if (viaAction) return false;
  return (ACTION_ONLY_ARTIFACT_TYPES as readonly string[]).includes(artifactType);
}

export { artifactTypeToObjectApiName, ACTION_ONLY_ARTIFACT_TYPES };
