"""Writing Ontology runtime (Palantir-style operational layer)."""

from .runtime import (
    ACTION_ONLY_ARTIFACT_TYPES,
    execute_action,
    is_action_only_artifact_type,
    load_registry,
    materialize_story_graph_mermaid,
    object_set,
    search_around,
    slice_story_graph_for_bible,
)

__all__ = [
    "ACTION_ONLY_ARTIFACT_TYPES",
    "execute_action",
    "is_action_only_artifact_type",
    "load_registry",
    "materialize_story_graph_mermaid",
    "object_set",
    "search_around",
    "slice_story_graph_for_bible",
]
