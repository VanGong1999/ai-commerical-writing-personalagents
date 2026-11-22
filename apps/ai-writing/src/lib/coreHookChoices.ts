import { flattenCoreHookCandidate, type Artifact, type CoreHookBody } from "@xiezuomanju/domain";

type CoreHookRow = {
  id: string;
  artifact: Artifact;
  body: CoreHookBody;
  itemIndex?: number;
};

function isActiveCoreHook(artifact: Artifact): boolean {
  return artifact.type === "core_hook" &&
    artifact.status !== "archived" &&
    artifact.status !== "rejected";
}

/** Expand batch items into candidate rows while retaining their original references. */
export function coreHookRows(artifacts: readonly Artifact[]): CoreHookRow[] {
  const rows: CoreHookRow[] = [];
  for (const artifact of artifacts) {
    if (!isActiveCoreHook(artifact)) continue;
    const body = artifact.bodyJson ?? {};
    const { items, candidate } = body;
    if (Array.isArray(items) && items.length) {
      items.forEach((item, itemIndex) => {
        const flat = flattenCoreHookCandidate(item);
        if (flat) {
          rows.push({ id: `${artifact.id}#${itemIndex}`, artifact, body: flat, itemIndex });
        }
      });
    } else if (candidate) {
      const flat = flattenCoreHookCandidate(body);
      if (flat) {
        rows.push({ id: artifact.id, artifact, body: flat });
      }
    } else {
      rows.push({ id: artifact.id, artifact, body: body as CoreHookBody });
    }
  }
  return rows;
}

export function routineCoreHookArtifacts(artifacts: readonly Artifact[]): Artifact[] {
  return artifacts.filter((artifact) => isActiveCoreHook(artifact) && artifact.status !== "adopted");
}

export function selectedCoreHooks(rows: readonly CoreHookRow[], selected: ReadonlySet<string>) {
  const selectedRows = rows.filter((row) => selected.has(row.id));
  const activeIds = new Set(selectedRows.map((row) => row.id));
  const selectedIds = [...selected].filter((id) => activeIds.has(id));
  return { selectedRows, selectedIds };
}
