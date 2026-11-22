"""Adapter contract tests: no gate business rules are reproduced here."""

import ast
import inspect
from pathlib import Path

import pytest

from app import gates


# Public signatures from the pre-facade module, including keyword-only/defaults.
SIGNATURES = {
    'simple_hash': ('text: str', 'str'),
    'check_prompt_lock': ('editable_instruction: str, required_phrases: list[str], locked_hash: str, current_locked_system: str', 'list[dict[str, str]]'),
    'check_core_hook_adoption': ("body: dict[str, Any], mode: Literal['draft', 'strong']='strong'", 'list[dict[str, str]]'),
    'can_strong_adopt': ('checks: list[dict[str, str]]', 'bool'),
    'check_format_selected': ('fmt: str | None', 'dict[str, str]'),
    'check_chunk_policy': ('requested_chars: int | None=None, *, max_chars: int=3000, whole_book: bool=False', 'dict[str, str]'),
    'check_schema_fields': ('body: dict[str, Any] | None, required: list[str]', 'dict[str, str]'),
    'check_length_band': ('text: str, min_chars: int, max_chars: int', 'dict[str, str]'),
    'check_scene_count': ('text: str, max_scenes: int=3', 'dict[str, str]'),
    'check_hook_presence': ('text: str, *, hook_flag: bool | None=None', 'dict[str, str]'),
    'check_deai_checklist': ('text: str, extra_banned: list[str] | None=None', 'list[dict[str, str]]'),
    'check_budget': ('used: int, budget: int | None', 'dict[str, str]'),
    'check_logic_ack': ('acked: bool', 'dict[str, str]'),
    'check_novelization': ('text: str', 'dict[str, str]'),
    'check_scene_triple': ('body: dict[str, Any] | None', 'dict[str, str]'),
    'check_episode_standalone': ('body: dict[str, Any] | None', 'dict[str, str]'),
    'check_title_clarity': ('title: str | None', 'dict[str, str]'),
    'check_stage_lock': ('body: dict[str, Any] | None', 'dict[str, str]'),
    'check_bio_complete': ('body: dict[str, Any] | None', 'dict[str, str]'),
    'check_empathy': ('body: dict[str, Any] | None', 'dict[str, str]'),
    'check_suspense_budget': ('body: dict[str, Any] | None', 'dict[str, str]'),
    'check_revise20_pass': ('checks: list[Any] | None, expect: int=20', 'dict[str, str]'),
    'check_unit_plan': ('units: list[Any] | None', 'dict[str, str]'),
    'check_cool_focus': ('body: dict[str, Any] | None', 'dict[str, str]'),
    'check_cool_stack_min': ('stack: list[Any] | None, min_n: int=3', 'dict[str, str]'),
    'check_rule_complexity': ('rules: list[Any] | None, max_n: int=5', 'dict[str, str]'),
    'check_cool_per_ep': ('body: dict[str, Any] | None', 'dict[str, str]'),
    'check_beat_completeness': ('beats: list[Any] | None, *, expect: int=20', 'dict[str, str]'),
    'check_paywall_coverage': ('slots: list[Any] | None, *, min_slots: int=3', 'dict[str, str]'),
    'check_shell_gate': ('shell: str | None', 'dict[str, str]'),
    'check_pay_motive': ('body: dict[str, Any] | None', 'dict[str, str]'),
    'check_ep1_hook': ('text: str, *, hook_flag: bool | None=None', 'dict[str, str]'),
    'check_redline_hard': ('text: str', 'dict[str, str]'),
    'check_one_plus_one': ('body: dict[str, Any] | None', 'dict[str, str]'),
    'check_eight_trope_coverage': ('tropes: list[Any] | None, *, min_hit: int=3', 'dict[str, str]'),
    'check_gender_path': ('path: str | None', 'dict[str, str]'),
    'check_midpoint_position': ('index: int | None, *, total: int=20', 'dict[str, str]'),
    'check_pitch_completeness': ('body: dict[str, Any] | None', 'dict[str, str]'),
    'check_human_confirm': ('acked: bool', 'dict[str, str]'),
    'check_similarity_risk': ('score: float | None, *, threshold: float=0.75', 'dict[str, str]'),
    'check_genre_trim': ('genre: str | None, blacklist: list[str] | None=None', 'dict[str, str]'),
    'check_length_decay': ('*, lengths: list[float] | None=None, current_chars: float | None=None, prev_chars: float | None=None, min_chars: int=800, ratio: float=0.7', 'dict[str, str]'),
    'check_logline_100_ack': ('acked: bool, logline: str | None=None', 'dict[str, str]'),
    'check_pitch_four_pack': ('counts: dict | None', 'dict[str, str]'),
    'check_outline_no_even_acts': ('text: str, *, strict: bool=True', 'dict[str, str]'),
    'check_ooc_heuristic': ('*, flagged: bool=False, bible: str | None=None, text: str | None=None', 'dict[str, str]'),
    'run_gate_battery': ('name: str, **kwargs: Any', 'list[dict[str, str]]'),
    'check_graph_consistency': ('kwargs: dict[str, Any]', 'dict[str, str]'),
    'all_passed': ('checks: list[dict[str, str]]', 'bool'),
}

DIRECT_CALLS = {
    'simple_hash': 'simpleHash',
    'check_prompt_lock': 'checkPromptLock',
    'check_core_hook_adoption': 'checkCoreHookAdoption',
    'can_strong_adopt': 'canStrongAdopt',
    'check_format_selected': 'checkFormatSelected',
    'check_schema_fields': 'checkSchemaFields',
    'check_length_band': 'checkLengthBand',
    'check_scene_count': 'checkSceneCount',
    'check_hook_presence': 'checkHookPresence',
    'check_budget': 'checkBudget',
    'check_logic_ack': 'checkLogicAck',
    'check_novelization': 'checkNovelization',
    'check_scene_triple': 'checkSceneTriple',
    'check_episode_standalone': 'checkEpisodeStandalone',
    'check_title_clarity': 'checkTitleClarity',
    'check_stage_lock': 'checkStageLock',
    'check_bio_complete': 'checkBioComplete',
    'check_empathy': 'checkEmpathy',
    'check_suspense_budget': 'checkSuspenseBudget',
    'check_revise20_pass': 'checkRevise20Pass',
    'check_unit_plan': 'checkUnitPlan',
    'check_cool_focus': 'checkCoolFocus',
    'check_cool_stack_min': 'checkCoolStackMin',
    'check_rule_complexity': 'checkRuleComplexity',
    'check_cool_per_ep': 'checkCoolPerEp',
    'check_beat_completeness': 'checkBeatCompleteness',
    'check_paywall_coverage': 'checkPaywallCoverage',
    'check_shell_gate': 'checkShellGate',
    'check_pay_motive': 'checkPayMotive',
    'check_redline_hard': 'checkRedlineHard',
    'check_one_plus_one': 'checkOnePlusOne',
    'check_eight_trope_coverage': 'checkEightTropeCoverage',
    'check_gender_path': 'checkGenderPath',
    'check_pitch_completeness': 'checkPitchCompleteness',
    'check_human_confirm': 'checkHumanConfirm',
    'check_similarity_risk': 'checkSimilarityRisk',
    'check_genre_trim': 'checkGenreTrim',
    'check_logline_100_ack': 'checkLogline100Ack',
    'check_outline_no_even_acts': 'checkOutlineNoEvenActs',
    'all_passed': 'allPassed',
}


def test_public_signatures_are_preserved():
    module = ast.parse(Path(gates.__file__).read_text())
    actual = {
        node.name: (ast.unparse(node.args), ast.unparse(node.returns))
        for node in module.body
        if isinstance(node, ast.FunctionDef) and not node.name.startswith("_")
    }
    assert actual == SIGNATURES


@pytest.mark.parametrize("name,ts_name", DIRECT_CALLS.items())
def test_direct_adapters_forward_arguments_and_response(monkeypatch, name, ts_name):
    function = getattr(gates, name)
    signature = inspect.signature(function)
    args, kwargs, expected = [], {}, []
    for parameter in signature.parameters.values():
        value = f"value_{parameter.name}"
        expected.append(value)
        if parameter.kind == inspect.Parameter.KEYWORD_ONLY:
            kwargs[parameter.name] = value
        else:
            args.append(value)
    response = object()
    calls = []
    monkeypatch.setattr(gates, "call_gate", lambda *args: calls.append(args) or response)
    assert function(*args, **kwargs) is response
    assert calls == [(ts_name, *expected)]


@pytest.mark.parametrize("name,args,kwargs,expected,shape", [
    ("check_chunk_policy", (), {}, ("checkChunkPolicy", {
        "requestedChars": None, "maxChars": 3000, "wholeBook": False,
    }), "direct"),
    ("check_chunk_policy", (500,), {"max_chars": 900, "whole_book": True},
     ("checkChunkPolicy", {"requestedChars": 500, "maxChars": 900, "wholeBook": True}), "direct"),
    ("check_deai_checklist", ("text",), {}, ("checkDeAIChecklist", "text", []), "list"),
    ("check_deai_checklist", ("text", ["phrase"]), {},
     ("checkDeAIChecklist", "text", ["phrase"]), "list"),
    ("check_ep1_hook", ("text",), {"hook_flag": False},
     ("runGateBattery", "Ep1Hook", {"text": "text", "hook_flag": False}), "first"),
    ("check_midpoint_position", (None,), {}, ("checkMidpointIndex", None, 20), "direct"),
    ("check_midpoint_position", (4,), {"total": 10}, ("checkMidpointIndex", 4, 10), "direct"),
    ("check_length_decay", (), {}, ("checkLengthDecay", {
        "lengths": None, "currentChars": None, "prevChars": None, "minChars": 800, "ratio": 0.7,
    }), "direct"),
    ("check_length_decay", (), {"lengths": [2, 3], "current_chars": 4,
     "prev_chars": 5, "min_chars": 0, "ratio": 0}, ("checkLengthDecay", {
        "lengths": [2, 3], "currentChars": 4, "prevChars": 5, "minChars": 0, "ratio": 0,
    }), "direct"),
    ("check_ooc_heuristic", (), {}, ("checkOocHeuristic", {
        "flagged": False, "bibleSnippet": None, "text": None,
    }), "direct"),
    ("check_ooc_heuristic", (), {"flagged": True, "bible": "bible", "text": "text"},
     ("checkOocHeuristic", {"flagged": True, "bibleSnippet": "bible", "text": "text"}), "direct"),
    ("check_pitch_four_pack", (None,), {},
     ("checkPitchFourPack", {"coreHook": 0, "episodeOutline": 0}), "direct"),
    ("check_pitch_four_pack", ({"core_hook": 2, "episode_outline": 10, "character": 1},), {},
     ("checkPitchFourPack", {"core_hook": 2, "episode_outline": 10, "character": 1,
                            "coreHook": 2, "episodeOutline": 10}), "direct"),
    ("run_gate_battery", ("SomeGate",), {"body": {"x": 1}, "max_chars": 0},
     ("runGateBattery", "SomeGate", {"body": {"x": 1}, "max_chars": 0}), "direct"),
    ("check_graph_consistency", ({"body": {"nodes": []}, "current_ep": 3},), {},
     ("runGateBattery", "GraphConsistency", {"body": {"nodes": []}, "current_ep": 3}), "first"),
])
def test_adapted_calls(monkeypatch, name, args, kwargs, expected, shape):
    response = {"id": "shared_result"}
    bridge_response = [response] if shape == "first" else response
    calls = []
    monkeypatch.setattr(gates, "call_gate", lambda *args: calls.append(args) or bridge_response)
    result = getattr(gates, name)(*args, **kwargs)
    assert result == ([response] if shape == "list" else bridge_response[0] if shape == "first" else response)
    assert calls == [expected]


def test_bridge_errors_propagate_without_python_fallback(monkeypatch):
    def fail(*args):
        raise RuntimeError("canonical gate unavailable")
    monkeypatch.setattr(gates, "call_gate", fail)
    with pytest.raises(RuntimeError, match="canonical gate unavailable"):
        gates.check_logic_ack(True)


def test_relative_decay_is_advisory_through_shared_engine():
    warning = gates.check_length_decay(lengths=[1200, 800])
    assert warning["result"] == "warn"
    assert gates.run_gate_battery("LengthDecay", lengths=[1200, 800]) == [warning]
    assert gates.can_strong_adopt([warning])
    assert gates.check_length_decay(lengths=[1200, 799])["result"] == "fail"
    assert gates.check_length_decay(prev_chars=1200)["result"] == "inconclusive"
