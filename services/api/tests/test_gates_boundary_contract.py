"""Regression boundaries exercised through the real cross-language transport."""
import pytest

from app import gates


@pytest.mark.parametrize('value', [False, 0, '', [], {}])
def test_empty_json_markers_do_not_satisfy_required_content(value):
    assert gates.check_bio_complete({
        'name':'甲', 'role':'主角', 'want':value, 'fear':value, 'flaw':value,
    })['result'] == 'fail'
    assert gates.check_cool_focus({'cool_focus':value})['result'] == 'fail'
    assert gates.check_cool_per_ep({'cool_per_ep':value})['result'] == 'fail'
    assert gates.check_revise20_pass([{'pass':value}] * 20)['result'] == 'fail'


@pytest.mark.parametrize('marker', [False, [], {}, 'false'])
@pytest.mark.parametrize('name', ['LogicAck', 'HumanConfirm', 'PriorityLock', 'Logline100Ack'])
def test_malformed_confirmation_markers_never_grant_approval(name, marker):
    checks = gates.run_gate_battery(name, acked=marker, logline='作者亲自修改的故事文案')
    assert not gates.all_passed(checks)


@pytest.mark.parametrize('text', ['😀' * 61, '中' * 130])
def test_length_advice_cannot_bypass_human_confirmation(text):
    assert gates.check_logline_100_ack(False, text)['result'] == 'fail'


def test_unicode_title_and_episode_use_codepoints():
    assert gates.check_title_clarity('😀' * 13)['result'] == 'pass'
    assert gates.check_title_clarity('😀' * 25)['result'] == 'fail'
    body = {'scene_header':'旧站台', 'triple':{'info':'情报', 'progress':'推进', 'change':'改变'},
            'clip_candidate':'钥匙', 'script_body':'😀' * 60}
    assert gates.check_episode_standalone(body)['result'] == 'fail'
    body['script_body'] = '😀' * 120
    assert gates.check_episode_standalone(body)['result'] == 'pass'


def test_empty_primary_risk_flags_do_not_mask_alias_warning():
    checks = gates.check_core_hook_adoption({
        'motivation':'寻找亲人', 'openingStructure':'遗失钥匙',
        'riskFlags':[], 'risk_flags':['风险待审核'],
    })
    assert any(c['id'] == 'risk' and c['result'] == 'warn' for c in checks)


def test_fractional_character_count_preserves_legacy_rounding():
    assert gates.check_length_decay(current_chars=899.9, prev_chars=1285)['result'] == 'warn'
    assert gates.check_length_decay(lengths=[1285, 899.9])['result'] == 'warn'
