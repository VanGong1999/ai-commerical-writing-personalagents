# Ontology consistency contract

Ontology actions own object changes and materialize mapped Artifacts through the same content-edit path as the editor. This preserves Artifact versions, clears adoption on narrative changes, invalidates LogicAck, and marks dependent content for review. Canonical `sliceForBible` and `StoryContinuity` queries select adopted StoryGraph objects; candidates remain available in Object Explorer.

## Reviewable scenario workflow

Use `POST /api/v1/ontology/actions/submit` with `projectId`, `actionApiName`, and `parameters`:

1. `CreateScenario`: `{ "label": "Alternative", "baseRids": ["<existing object RID>"] }`.
2. Read `/api/v1/ontology/projects/<projectId>/scenarios`. Each row includes `forkedProperties`, `baselines`, and a branch `contentHash`.
3. `UpdateScenario`: `{ "scenarioRid": "<scenario RID>", "expectedBranchHash": "<branch contentHash>", "forkedProperties": { "<base object RID>": { "title": "Revised title" } } }`. Patches merge into branch properties only. A stale branch hash returns HTTP 409. The response supplies `sideEffects.scenarioContentHash`.
4. `MergeScenario`: `{ "scenarioRid": "<scenario RID>", "confirmed": true }`. Only literal boolean `true` confirms a merge.

Create stores immutable object hash, version and status baselines in existing scenario JSON under the reserved `__baseline__` key. The public response separates this metadata from `forkedProperties`. Legacy scenarios without baselines fail closed and must be recreated; baselines cannot be reconstructed safely after mainline edits.

Merge validates every base object before applying any changes. A changed or deleted mainline object returns HTTP 409 with `detail.error = "scenario_conflict"` and `detail.conflicts` containing the RID, expected baseline, and actual state. Unknown objects in branch storage are rejected. All object, Artifact, review-state and scenario changes commit together or roll back together. SQL version comparisons prevent lost object updates; a scenario status/timestamp comparison prevents concurrent branch edit/merge claims. Repeating an already successful merge succeeds with `sideEffects.alreadyMerged = true`, without changing content or versions. This replay guarantee is specific to a scenario merge, not a general action idempotency key.

RID references in action parameters and nested provenance must resolve inside the action's project. Object types cannot change during an update, and backing Artifacts must belong to the same project. Narrative-only object replacements retain existing `sourceRefs` and `provenance`; callers can explicitly supply those fields to replace or clear them. Version snapshots retain prior source evidence and action/actor lineage.

TypeScript `createScenario` requires each object's `projectId`, `version`, and `status`; `mergeScenarioPatches` requires the current objects. Returned patches include `previousHash` and `previousVersion`; a storage adapter must enforce these comparisons in one transaction. These helpers do not write storage.
