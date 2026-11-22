from app.gates import can_strong_adopt, check_core_hook_adoption, check_prompt_lock, simple_hash


def test_prompt_lock_pass():
    locked = "LOCKED RULES"
    h = simple_hash(locked)
    checks = check_prompt_lock("请写动机与开篇", ["动机", "开篇"], h, locked)
    assert all(c["result"] == "pass" for c in checks)


def test_prompt_lock_fail_on_tamper():
    locked = "LOCKED RULES"
    h = simple_hash(locked)
    checks = check_prompt_lock("ok", [], h, locked + " tampered")
    assert any(c["id"] == "prompt_lock_hash" and c["result"] == "fail" for c in checks)


def test_core_hook_strong_requires_motivation():
    checks = check_core_hook_adoption(
        {"motivation": "", "openingStructure": "开场", "riskFlags": []},
        "strong",
    )
    assert not can_strong_adopt(checks)


def test_hook_quality_is_not_keyword_or_punctuation_presence():
    from app.gates import check_hook_presence

    for text in ["他解开最后一道锁，箱中放着十年前自己的死亡证明。", "突然？", "下集悬念钩子", "他关门离开。"]:
        assert check_hook_presence(text)["result"] == "warn"
    assert check_hook_presence("正文", hook_flag=True)["result"] == "pass"
    assert check_hook_presence("突然？", hook_flag=False)["result"] == "warn"


def test_deai_gate_advises_on_style_and_preserves_schema_hard_failure():
    from app.gates import check_deai_checklist, run_gate_battery

    assert check_deai_checklist("月色宛如薄霜，河水犹如碎银，他不禁停步。")[0]["result"] == "warn"
    assert check_deai_checklist("“综上所述，值得注意的是。”")[0]["result"] == "pass"
    assert check_deai_checklist("个人口头禅", ["口头禅"])[0]["result"] == "warn"
    assert run_gate_battery("Schema", body={}, required=["title"])[0]["result"] == "fail"


def test_optional_contextual_review_reports():
    from app.gates import check_novelization, check_ep1_hook, check_redline_hard

    for text in ["妹妹：他想卖房，她想留下，内心独白。", "他想她想得明白，内心独白如潮。"]:
        review = check_novelization(text)
        assert review["result"] == "warn"
        assert "第1行" in review["message"] and "可拍性" in review["message"]
    for flag in [None, False]:
        assert check_ep1_hook("突然？", hook_flag=flag)["result"] == "warn"
    for text in ["班主任：如何避免美化自残。", "他要求美化自残。"]:
        assert check_redline_hard(text)["result"] == "warn"
