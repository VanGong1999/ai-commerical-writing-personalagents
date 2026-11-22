import pytest
from llm_gateway import ChatMessage, LLMGateway
from llm_gateway.settings import GatewaySettings

TOOLS=[{'type':'function','function':{'name':'inspect','parameters':{'type':'object','properties':{}}}}]
def build(messages, model='deepseek-flash', extra=None, tools=TOOLS):
    return LLMGateway(GatewaySettings(_env_file=None))._build_chat_payload(
        messages,resolved_model=model,url='https://api.deepseek.com',temperature=.2,
        max_tokens=128,tools=tools,tool_choice='auto',extra_body=extra)

def history(reasoning=None):
    return [ChatMessage(role='user',content='检查现有产物'),
            ChatMessage(role='assistant',content=None,reasoning_content=reasoning,
                        tool_calls=[{'id':'call-original','type':'function','function':{'name':'inspect','arguments':'{}'}}]),
            ChatMessage(role='tool',tool_call_id='call-original',content='已有三张卡')]

def test_cross_provider_tool_resume_disables_thinking_without_fabricating_reasoning():
    messages=history();payload=build(messages)
    assert payload['thinking']=={'type':'disabled'}
    assert payload['messages']==[m.to_openai() for m in messages]
    assert 'reasoning_content' not in payload['messages'][1]
    assert messages[1].reasoning_content is None

def test_history_with_complete_reasoning_keeps_provider_default_thinking():
    assert 'thinking' not in build(history('stored provider reasoning'))

def test_deepseek_requires_reasoning_for_plain_assistant_turns_too_when_tools_present():
    messages=[ChatMessage(role='user',content='先检查'),ChatMessage(role='assistant',content='已检查'),ChatMessage(role='user',content='继续')]
    assert build(messages)['thinking']=={'type':'disabled'}

def test_explicit_thinking_enabled_fails_actionably_before_http_instead_of_inventing_history():
    with pytest.raises(ValueError,match='reasoning_content.*thinking'):
        build(history(),extra={'thinking':{'type':'enabled'}})
    assert build(history('exact reasoning'),extra={'thinking':{'type':'enabled'}})['thinking']=={'type':'enabled'}

def test_explicit_thinking_disabled_is_preserved():
    assert build(history(),extra={'thinking':{'type':'disabled'}})['thinking']=={'type':'disabled'}

def test_compatibility_policy_is_limited_to_deepseek_tool_history():
    assert 'thinking' not in build(history(),model='MiniMax-M3.1-Flash')
    assert 'thinking' not in build(history(),model='gpt-4.1')
    assert 'thinking' not in build(history(),tools=None)
    assert 'thinking' not in build([ChatMessage(role='user',content='首次请求')])


@pytest.mark.asyncio
async def test_deepseek_compatibility_toggle_does_not_leak_to_minimax_failover(monkeypatch):
    import json
    import httpx
    from llm_gateway import client as module
    seen=[]
    def handler(request):
        payload=json.loads(request.content)
        seen.append(payload)
        if len(seen)==1:
            return httpx.Response(429,json={'error':'rate'})
        return httpx.Response(200,json={'choices':[{'message':{'content':'ok'}}]})
    client=httpx.AsyncClient(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(module,'_shared_client',client)
    original=module._post_with_retry
    async def once(*args,**kwargs):
        kwargs['max_retries']=0
        return await original(*args,**kwargs)
    monkeypatch.setattr(module,'_post_with_retry',once)
    try:
        result=await LLMGateway(GatewaySettings(_env_file=None)).chat(
            history(),provider='custom',base_url='https://api.deepseek.com',api_key='test',
            model='deepseek-flash',tools=TOOLS,fallbacks=[{'base_url':'https://api.minimaxi.com/v1','api_key':'test','model':'MiniMax-M3.1-Flash'}])
        assert result.content=='ok'
        assert seen[0]['thinking']=={'type':'disabled'}
        assert 'thinking' not in seen[1]
        assert seen[1]['reasoning_effort']=='low'
    finally:
        await client.aclose()
