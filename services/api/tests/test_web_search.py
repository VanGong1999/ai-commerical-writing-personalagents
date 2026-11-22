from types import SimpleNamespace

import httpx
import pytest

from app import web_search as ws


@pytest.fixture(autouse=True)
def isolate_fallback_config(monkeypatch):
    monkeypatch.setattr(ws, '_deepseek_fallback_provider', lambda: None)


@pytest.mark.asyncio
async def test_minimax_preserves_structured_sources_and_bounds_output(monkeypatch):
    payload = {
        'output_text': 'current report ' * 1000,
        'output': [
            {'type': 'web_search_call', 'status': 'completed', 'action': {
                'type': 'search', 'sources': [
                    {'url': 'https://official.example/news'},
                    {'url': 'https://second.example/news'},
                    {'url': 'javascript:alert(1)'},
                ]}},
            {'type': 'message', 'content': [{'type': 'output_text', 'text': 'nested report',
                'annotations': [{'type': 'url_citation', 'url': 'https://official.example/news',
                    'title': 'Official announcement', 'content': 'real snippet ' * 200}]}]},
        ],
    }
    async def post(self, url, **kwargs):
        assert kwargs['json']['max_output_tokens'] <= 1200
        assert 'web_search_call.action.sources' in kwargs['json']['include']
        return httpx.Response(200, json=payload, request=httpx.Request('POST', url))
    monkeypatch.setattr(httpx.AsyncClient, 'post', post)
    result = await ws._minimax_search({'base_url': 'https://api.example/v1', 'api_key': 'fake', 'model': 'test'}, 'query', 2)
    assert result['availability'] == 'available'
    assert len(result['results']) == 2
    assert result['results'][0]['title'] == 'Official announcement'
    assert len(result['results'][0]['snippet']) <= 800
    assert len(result['summary']) <= 1800


@pytest.mark.asyncio
async def test_no_citations_never_returns_model_current_claims(monkeypatch):
    async def post(self, url, **kwargs):
        return httpx.Response(200, json={'output_text': 'TODAY fabricated trend https://invented.example'}, request=httpx.Request('POST', url))
    monkeypatch.setattr(httpx.AsyncClient, 'post', post)
    result = await ws._minimax_search({'base_url': 'https://api.example/v1', 'api_key': 'fake', 'model': 'test'}, 'query', 5)
    assert result['availability'] == 'unverified'
    assert result['results'] == []
    assert 'TODAY' not in result['summary']
    assert '未核验' in result['summary']


@pytest.mark.asyncio
async def test_missing_sources_uses_configured_external_fallback(monkeypatch):
    monkeypatch.setattr(ws, '_search_provider', lambda: {'kind': 'minimax'})
    monkeypatch.setattr(ws, 'get_settings', lambda: SimpleNamespace(bocha_api_key='key', serper_api_key=''))
    async def minimax(*args):
        return {'enabled': True, 'results': [], 'availability': 'unverified', 'summary': '未核验', 'source': 'minimax'}
    async def external(query, limit):
        return {'enabled': True, 'results': [{'url': 'https://external.example'}], 'source': 'bocha'}
    monkeypatch.setattr(ws, '_minimax_search', minimax)
    monkeypatch.setattr(ws, '_external_search', external)
    result = await ws.web_search('query')
    assert result['source'] == 'bocha'
    assert result['results']


def test_action_sources_are_real_evidence_without_generated_url_scraping():
    result = ws._response_sources({
        'output_text': 'https://made-up.example',
        'output': [
            {'type': 'web_search_call', 'status': 'failed', 'action': {'sources': [{'url': 'https://failed.example'}]}},
            {'type': 'web_search_call', 'status': 'completed', 'action': {'sources': [
                {'url': 'javascript:bad'}, {'url': 'https://real.example'}, {'url': 'https://real.example'},
            ]}},
        ],
    }, 5)
    assert [r['url'] for r in result] == ['https://real.example']


@pytest.mark.asyncio
async def test_no_sources_public_response_remains_truthful_without_fallback(monkeypatch):
    monkeypatch.setattr(ws, '_search_provider', lambda: {'kind': 'glm'})
    monkeypatch.setattr(ws, 'get_settings', lambda: SimpleNamespace(bocha_api_key='', serper_api_key=''))
    async def glm(*args):
        return {'enabled': True, 'results': [], 'summary': 'TODAY popular made-up rankings', 'source': 'glm'}
    monkeypatch.setattr(ws, '_glm_search', glm)
    result = await ws.web_search('latest news')
    assert result['availability'] == 'unverified'
    assert 'TODAY' not in result['summary']


@pytest.mark.asyncio
async def test_unsupported_provider_attempts_external_fallback(monkeypatch):
    monkeypatch.setattr(ws, '_search_provider', lambda: {'kind': 'minimax'})
    monkeypatch.setattr(ws, 'get_settings', lambda: SimpleNamespace(bocha_api_key='', serper_api_key='key'))
    async def unsupported(*args):
        response = httpx.Response(400, request=httpx.Request('POST', 'https://provider.example'))
        response.raise_for_status()
    async def external(query, limit):
        return {'enabled': True, 'results': [{'url': 'https://external.example'}], 'source': 'serper'}
    monkeypatch.setattr(ws, '_minimax_search', unsupported)
    monkeypatch.setattr(ws, '_external_search', external)
    result = await ws.web_search('query')
    assert result['source'] == 'serper'
    assert result['fallbackFrom'] == 'minimax'


@pytest.mark.asyncio
async def test_configured_deepseek_fallback_returns_only_structured_results(monkeypatch):
    monkeypatch.setattr(ws, '_search_provider', lambda: {'kind': 'minimax'})
    monkeypatch.setattr(ws, 'get_settings', lambda: SimpleNamespace(bocha_api_key='', serper_api_key=''))
    monkeypatch.setattr(ws, '_deepseek_fallback_provider', lambda: {'kind': 'deepseek'})
    async def no_sources(*args):
        return ws._unverified('query', 'minimax')
    async def deepseek(*args):
        return {'enabled': True, 'results': [{'url': 'https://search.example'}], 'source': 'deepseek', 'summary': 'actual snippet'}
    monkeypatch.setattr(ws, '_minimax_search', no_sources)
    monkeypatch.setattr(ws, '_deepseek_search', deepseek)
    result = await ws.web_search('query')
    assert result['source'] == 'deepseek'
    assert result['fallbackFrom'] == 'minimax'


@pytest.mark.asyncio
async def test_uncited_deepseek_fallback_cannot_restore_generated_claims(monkeypatch):
    monkeypatch.setattr(ws, '_search_provider', lambda: {'kind': 'minimax'})
    monkeypatch.setattr(ws, 'get_settings', lambda: SimpleNamespace(bocha_api_key='', serper_api_key=''))
    monkeypatch.setattr(ws, '_deepseek_fallback_provider', lambda: {'kind': 'deepseek'})
    async def no_sources(*args):
        return ws._unverified('query', 'minimax')
    async def deepseek(*args):
        return {'enabled': True, 'results': [], 'source': 'deepseek', 'summary': 'TODAY made-up rankings'}
    monkeypatch.setattr(ws, '_minimax_search', no_sources)
    monkeypatch.setattr(ws, '_deepseek_search', deepseek)
    result = await ws.web_search('query')
    assert result['availability'] == 'unverified'
    assert 'TODAY' not in result['summary']
