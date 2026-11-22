from llm_gateway import ChatMessage, LLMGateway
from llm_gateway.settings import GatewaySettings


def payload(model='MiniMax-M3.1-Flash', extra=None, max_tokens=None):
    return LLMGateway(GatewaySettings(_env_file=None))._build_chat_payload(
        [ChatMessage(role='user', content='优化这段')], resolved_model=model,
        url='https://api.minimaxi.com/v1/chat/completions', temperature=.2,
        max_tokens=max_tokens, tools=None, tool_choice=None, extra_body=extra)


def test_minimax_reasoning_default_leaves_budget_for_visible_writing():
    result=payload()
    assert result['reasoning_effort']=='low'
    assert result['max_tokens']==8192


def test_explicit_output_and_reasoning_choices_are_preserved():
    result=payload(extra={'reasoning_effort':'high'},max_tokens=12000)
    assert result['reasoning_effort']=='high'
    assert result['max_tokens']==12000


def test_reasoning_policy_does_not_leak_to_fallback_model():
    result=payload(model='deepseek-flash')
    assert 'reasoning_effort' not in result
    assert 'max_tokens' not in result


def test_private_reasoning_is_never_returned_as_visible_answer():
    result=LLMGateway._parse_chat_result({'choices':[{'message':{'content':'','reasoning':'private thought'}}]},'MiniMax-M3.1-Flash')
    assert result.content==''
    assert result.reasoning_content=='private thought'
