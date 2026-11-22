"""Typed Python adapters for the canonical TypeScript gate implementation.

The bridge executes the shared agent-runtime/domain gates. This module preserves
Python call signatures and return shapes; gate rules belong in TypeScript.
"""

from __future__ import annotations

from typing import Any, Literal

from .gate_bridge import call_gate

GateResult = Literal["pass", "fail", "warn", "inconclusive"]


def simple_hash(text: str) -> str:
    return call_gate("simpleHash", text)


def check_prompt_lock(
    editable_instruction: str,
    required_phrases: list[str],
    locked_hash: str,
    current_locked_system: str,
) -> list[dict[str, str]]:
    return call_gate(
        "checkPromptLock", editable_instruction, required_phrases,
        locked_hash, current_locked_system,
    )


def check_core_hook_adoption(
    body: dict[str, Any],
    mode: Literal["draft", "strong"] = "strong",
) -> list[dict[str, str]]:
    return call_gate("checkCoreHookAdoption", body, mode)


def can_strong_adopt(checks: list[dict[str, str]]) -> bool:
    return call_gate("canStrongAdopt", checks)


def check_format_selected(fmt: str | None) -> dict[str, str]:
    return call_gate("checkFormatSelected", fmt)


def check_chunk_policy(
    requested_chars: int | None = None,
    *,
    max_chars: int = 3000,
    whole_book: bool = False,
) -> dict[str, str]:
    return call_gate("checkChunkPolicy", {
        "requestedChars": requested_chars,
        "maxChars": max_chars,
        "wholeBook": whole_book,
    })


def check_schema_fields(body: dict[str, Any] | None, required: list[str]) -> dict[str, str]:
    return call_gate("checkSchemaFields", body, required)


def check_length_band(text: str, min_chars: int, max_chars: int) -> dict[str, str]:
    return call_gate("checkLengthBand", text, min_chars, max_chars)


def check_scene_count(text: str, max_scenes: int = 3) -> dict[str, str]:
    return call_gate("checkSceneCount", text, max_scenes)


def check_hook_presence(text: str, *, hook_flag: bool | None = None) -> dict[str, str]:
    return call_gate("checkHookPresence", text, hook_flag)


def check_deai_checklist(text: str, extra_banned: list[str] | None = None) -> list[dict[str, str]]:
    return [call_gate("checkDeAIChecklist", text, extra_banned or [])]


def check_budget(used: int, budget: int | None) -> dict[str, str]:
    return call_gate("checkBudget", used, budget)


def check_logic_ack(acked: bool) -> dict[str, str]:
    return call_gate("checkLogicAck", acked)


def check_novelization(text: str) -> dict[str, str]:
    return call_gate("checkNovelization", text)


def check_scene_triple(body: dict[str, Any] | None) -> dict[str, str]:
    return call_gate("checkSceneTriple", body)


def check_episode_standalone(body: dict[str, Any] | None) -> dict[str, str]:
    return call_gate("checkEpisodeStandalone", body)


def check_title_clarity(title: str | None) -> dict[str, str]:
    return call_gate("checkTitleClarity", title)


def check_stage_lock(body: dict[str, Any] | None) -> dict[str, str]:
    return call_gate("checkStageLock", body)


def check_bio_complete(body: dict[str, Any] | None) -> dict[str, str]:
    return call_gate("checkBioComplete", body)


def check_empathy(body: dict[str, Any] | None) -> dict[str, str]:
    return call_gate("checkEmpathy", body)


def check_suspense_budget(body: dict[str, Any] | None) -> dict[str, str]:
    return call_gate("checkSuspenseBudget", body)


def check_revise20_pass(checks: list[Any] | None, expect: int = 20) -> dict[str, str]:
    return call_gate("checkRevise20Pass", checks, expect)


def check_unit_plan(units: list[Any] | None) -> dict[str, str]:
    return call_gate("checkUnitPlan", units)


def check_cool_focus(body: dict[str, Any] | None) -> dict[str, str]:
    return call_gate("checkCoolFocus", body)


def check_cool_stack_min(stack: list[Any] | None, min_n: int = 3) -> dict[str, str]:
    return call_gate("checkCoolStackMin", stack, min_n)


def check_rule_complexity(rules: list[Any] | None, max_n: int = 5) -> dict[str, str]:
    return call_gate("checkRuleComplexity", rules, max_n)


def check_cool_per_ep(body: dict[str, Any] | None) -> dict[str, str]:
    return call_gate("checkCoolPerEp", body)


def check_beat_completeness(beats: list[Any] | None, *, expect: int = 20) -> dict[str, str]:
    return call_gate("checkBeatCompleteness", beats, expect)


def check_paywall_coverage(slots: list[Any] | None, *, min_slots: int = 3) -> dict[str, str]:
    return call_gate("checkPaywallCoverage", slots, min_slots)


def check_shell_gate(shell: str | None) -> dict[str, str]:
    return call_gate("checkShellGate", shell)


def check_pay_motive(body: dict[str, Any] | None) -> dict[str, str]:
    return call_gate("checkPayMotive", body)


def check_ep1_hook(text: str, *, hook_flag: bool | None = None) -> dict[str, str]:
    return call_gate("runGateBattery", "Ep1Hook", {"text": text, "hook_flag": hook_flag})[0]


def check_redline_hard(text: str) -> dict[str, str]:
    return call_gate("checkRedlineHard", text)


def check_one_plus_one(body: dict[str, Any] | None) -> dict[str, str]:
    return call_gate("checkOnePlusOne", body)


def check_eight_trope_coverage(tropes: list[Any] | None, *, min_hit: int = 3) -> dict[str, str]:
    return call_gate("checkEightTropeCoverage", tropes, min_hit)


def check_gender_path(path: str | None) -> dict[str, str]:
    return call_gate("checkGenderPath", path)


def check_midpoint_position(index: int | None, *, total: int = 20) -> dict[str, str]:
    return call_gate("checkMidpointIndex", index, total)


def check_pitch_completeness(body: dict[str, Any] | None) -> dict[str, str]:
    return call_gate("checkPitchCompleteness", body)


def check_human_confirm(acked: bool) -> dict[str, str]:
    return call_gate("checkHumanConfirm", acked)


def check_similarity_risk(score: float | None, *, threshold: float = 0.75) -> dict[str, str]:
    return call_gate("checkSimilarityRisk", score, threshold)


def check_genre_trim(genre: str | None, blacklist: list[str] | None = None) -> dict[str, str]:
    return call_gate("checkGenreTrim", genre, blacklist)


def check_length_decay(
    *,
    lengths: list[float] | None = None,
    current_chars: float | None = None,
    prev_chars: float | None = None,
    min_chars: int = 800,
    ratio: float = 0.7,
) -> dict[str, str]:
    return call_gate("checkLengthDecay", {
        "lengths": lengths,
        "currentChars": current_chars,
        "prevChars": prev_chars,
        "minChars": min_chars,
        "ratio": ratio,
    })


def check_logline_100_ack(acked: bool, logline: str | None = None) -> dict[str, str]:
    return call_gate("checkLogline100Ack", acked, logline)


def check_pitch_four_pack(counts: dict | None) -> dict[str, str]:
    options = dict(counts or {})
    options["coreHook"] = options.get("coreHook") or options.get("core_hook") or 0
    options["episodeOutline"] = options.get("episodeOutline") or options.get("episode_outline") or 0
    return call_gate("checkPitchFourPack", options)


def check_outline_no_even_acts(text: str, *, strict: bool = True) -> dict[str, str]:
    return call_gate("checkOutlineNoEvenActs", text, strict)


def check_ooc_heuristic(
    *,
    flagged: bool = False,
    bible: str | None = None,
    text: str | None = None,
) -> dict[str, str]:
    return call_gate("checkOocHeuristic", {"flagged": flagged, "bibleSnippet": bible, "text": text})


def run_gate_battery(name: str, **kwargs: Any) -> list[dict[str, str]]:
    return call_gate("runGateBattery", name, kwargs)


def check_graph_consistency(kwargs: dict[str, Any]) -> dict[str, str]:
    return call_gate("runGateBattery", "GraphConsistency", kwargs)[0]


def all_passed(checks: list[dict[str, str]]) -> bool:
    return call_gate("allPassed", checks)
