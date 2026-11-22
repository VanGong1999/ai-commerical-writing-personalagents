import asyncio

from app.deai_detector import LocalHeuristicDetector


def test_local_heuristic_detects_ai_phrases():
    detector = LocalHeuristicDetector()
    result = asyncio.run(
        detector.detect("综上所述，值得注意的是，宛如春风，不禁涌上心头。")
    )
    assert result.provider == "local-heuristic"
    assert result.score > 0
    assert any("综上所述" in h for h in result.hits)


def test_local_heuristic_passes_clean_text():
    detector = LocalHeuristicDetector()
    result = asyncio.run(
        detector.detect("他走进房间，看了一眼墙上的钟，然后坐下。")
    )
    assert result.verdict in ("pass", "warn")


def test_three_valid_expressions_never_fail_and_remain_advisory():
    result = asyncio.run(LocalHeuristicDetector().detect(
        "月色宛如薄霜。河水犹如碎银。听见旧唱片，他不禁停下脚步。"
    ))
    assert result.verdict != "fail"
    assert result.advisory is True
    assert result.reasons and result.density > 0
    assert {"provider", "score", "hits", "verdict"} <= result.to_dict().keys()


def test_dialogue_and_screenplay_pacing_are_not_style_violations():
    text = '“综上所述，值得注意的是，不难发现。”\n分镜1：门响。\n林舟：谁？\n旁白：雨停了。'
    result = asyncio.run(LocalHeuristicDetector().detect(text))
    assert result.verdict == "pass"
    assert result.hits == []


def test_repeated_narration_has_contextual_reasons_without_hard_failure():
    result = asyncio.run(LocalHeuristicDetector().detect("值得注意的是，灯亮了。" * 8))
    assert result.verdict == "warn"
    assert result.density > 0
    assert any("8次" in reason for reason in result.reasons)
    assert any("排比" in reason for reason in result.reasons)


def test_same_phrase_is_less_concerning_in_longer_text():
    detector = LocalHeuristicDetector()
    short = asyncio.run(detector.detect("宛如月光。犹如碎银。不禁停步。"))
    long = asyncio.run(detector.detect("宛如月光。犹如碎银。不禁停步。" + "他推开门，把湿外套挂在门后，" * 100))
    assert short.density > long.density
    assert short.score > long.score
