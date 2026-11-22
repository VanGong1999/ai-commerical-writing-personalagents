"""Admission regressions; never contact configured Redis or models."""
import asyncio
import json
import pytest
from app import llm_governor as gov
from app import llm_service as svc
from app.routers.llm import _rate_limited_response

@pytest.fixture(autouse=True)
def isolated_governor(monkeypatch):
    monkeypatch.setenv('LLM_MIN_REQUEST_INTERVAL_S', '0')
    monkeypatch.setattr(gov, '_get_redis', lambda: None)
    monkeypatch.setattr(gov, 'load_config', lambda *a: gov.TrafficConfig(worker_concurrency_cap=1))
    gov.reset_memory_for_tests()
    yield
    gov.reset_memory_for_tests()

def test_local_busy_is_not_provider_throttle():
    response = _rate_limited_response(svc.LlmBusyError(retry_after_s=2))
    body = json.loads(response.body)
    assert response.status_code == 503
    assert body['code'] == 'local_queue_timeout'
    assert body['source'] == 'local'
    assert body['retryable'] is True
    assert body['governorReported'] is False
    assert body['retryAfter'] == body['retryAfterS'] == 2

async def test_waiting_admission_succeeds_without_new_model_attempt():
    first = await gov.acquire(timeout_s=0)
    assert first
    waiter = asyncio.create_task(gov.acquire(timeout_s=1))
    await asyncio.sleep(0.02)
    assert not waiter.done()
    gov.release(first)
    second = await waiter
    assert second and second != first
    gov.release(first)
    assert gov.status().inflight == 1
    gov.release(second)
    assert gov.status().inflight == 0

async def test_admission_timeout_and_cancellation_do_not_leak():
    first = await gov.acquire(timeout_s=0)
    assert await gov.acquire(timeout_s=0.01) is None
    waiter = asyncio.create_task(gov.acquire(timeout_s=1))
    await asyncio.sleep(0)
    waiter.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiter
    assert gov.status().inflight == 1
    gov.release(first)

def test_abandoned_lease_expires(monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(gov.time, 'time', lambda: clock[0])
    first = gov.reserve(lease_s=10)
    assert first
    assert gov.reserve(lease_s=10) is None
    clock[0] += 11
    second = gov.reserve(lease_s=10)
    assert second and second != first
    gov.release(first)
    assert gov.status().inflight == 1
    gov.release(second)

@pytest.fixture
def isolated_redis(tmp_path, monkeypatch):
    """Memory-only Redis on a private socket, never the configured server."""
    import shutil
    import subprocess
    import time
    import redis
    executable = shutil.which('redis-server')
    if not executable:
        pytest.skip('redis-server unavailable for isolated Lua integration')
    import tempfile
    directory = tempfile.TemporaryDirectory(prefix='llm-redis-', dir='/tmp')
    socket = directory.name + '/redis.sock'
    process = subprocess.Popen(
        [executable, '--port', '0', '--unixsocket', socket, '--save', '', '--appendonly', 'no'],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    client = redis.Redis(unix_socket_path=socket, decode_responses=True, socket_connect_timeout=0.1, socket_timeout=0.1)
    try:
        for _ in range(100):
            try:
                if client.ping():
                    break
            except redis.ConnectionError:
                time.sleep(0.01)
        else:
            pytest.fail('isolated Redis did not start')
        monkeypatch.setattr(gov, '_get_redis', lambda: client)
        yield client
    finally:
        client.close()
        process.terminate()
        process.wait(timeout=3)
        directory.cleanup()


def test_redis_abandoned_leases_expire_without_resetting_live_owners(isolated_redis, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(gov.time, 'time', lambda: clock[0])
    isolated_redis.set('llm:gov:inflight', 999)
    first = gov.reserve(lease_s=10)
    assert first
    assert gov.status().inflight == 1
    assert gov.reserve() is None
    clock[0] += 11
    second = gov.reserve(lease_s=100)
    assert second and second != first
    gov.release(first)
    gov.release(first)
    assert gov.status().inflight == 1
    gov.release(second)
    assert gov.status().inflight == 0


def test_redis_atomic_capacity_under_thread_contention(isolated_redis):
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=8) as pool:
        leases = list(pool.map(lambda _: gov.reserve(), range(24)))
    admitted = [lease for lease in leases if lease]
    assert len(admitted) == 1
    gov.release(admitted[0])


async def test_service_waits_then_calls_gateway_once_and_releases(monkeypatch):
    calls = []
    class Gateway:
        async def chat(self, *args, **kwargs):
            calls.append(kwargs)
            return 'ok'
    monkeypatch.setattr(svc, 'get_gateway', lambda: Gateway())
    monkeypatch.setattr(svc, '_fallbacks_for', lambda *args: [])
    first = await gov.acquire(timeout_s=0)
    task = asyncio.create_task(svc.chat_completion(
        [{'role': 'user', 'content': 'hello'}], base_url='https://example.invalid', api_key='test',
    ))
    await asyncio.sleep(0.02)
    assert not calls
    gov.release(first)
    assert await task == 'ok'
    assert len(calls) == 1
    assert gov.status().inflight == 0


async def test_service_cancelled_provider_releases_lease(monkeypatch):
    started = asyncio.Event()
    class Gateway:
        async def chat(self, *args, **kwargs):
            started.set()
            await asyncio.Event().wait()
    monkeypatch.setattr(svc, 'get_gateway', lambda: Gateway())
    monkeypatch.setattr(svc, '_fallbacks_for', lambda *args: [])
    task = asyncio.create_task(svc.chat_completion(
        [{'role': 'user', 'content': 'hello'}], base_url='https://example.invalid', api_key='test',
    ))
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert gov.status().inflight == 0


def test_provider_response_preserves_retryability_and_original_detail():
    from llm_gateway import RateLimitedError
    exc = RateLimitedError('subscription exhausted', retry_after_s=7200)
    exc.retryable = False
    exc.governor_reported = True
    body = json.loads(_rate_limited_response(exc).body)
    assert body['code'] == 'provider_rate_limited'
    assert body['retryable'] is False
    assert body['detail'] == 'subscription exhausted'
    assert body['retryAfter'] == 7200


@pytest.mark.parametrize("backend", ["memory", "redis"])
def test_renewal_keeps_active_lease_but_never_revives_expired_owner(monkeypatch, backend, request):
    if backend == "redis":
        request.getfixturevalue("isolated_redis")
    clock = [1000.0]
    monkeypatch.setattr(gov.time, 'time', lambda: clock[0])
    lease = gov.reserve(lease_s=10)
    clock[0] += 9
    assert gov.renew(lease, lease_s=10)
    clock[0] += 2
    assert gov.reserve() is None
    clock[0] += 10
    assert not gov.renew(lease, lease_s=10)
    assert gov.reserve()

@pytest.mark.parametrize('backend', ['memory', 'redis'])
def test_configurable_pacing_waits_without_changing_capacity(backend, request, monkeypatch):
    if backend == 'redis':
        request.getfixturevalue('isolated_redis')
    clock = [1000.0]
    monkeypatch.setattr(gov.time, 'time', lambda: clock[0])
    monkeypatch.setenv('LLM_MIN_REQUEST_INTERVAL_S', '0.3')
    first = gov.reserve()
    assert first
    gov.release(first)
    assert gov.slots_available()
    assert gov.reserve() is None
    clock[0] += 0.31
    assert gov.reserve()

@pytest.mark.parametrize('retryable', [False, True])
async def test_service_only_observed_transient_throttle_changes_governor(retryable, monkeypatch):
    from llm_gateway import RateLimitedError
    exc = RateLimitedError('upstream detail', retry_after_s=60, provider_code='2056',
                           trace_id='test-trace', retryable=retryable)
    class Gateway:
        async def chat(self, *args, **kwargs):
            raise exc
    monkeypatch.setattr(svc, 'get_gateway', lambda: Gateway())
    monkeypatch.setattr(svc, '_fallbacks_for', lambda *args: [])
    with pytest.raises(RateLimitedError) as caught:
        await svc.chat_completion([{'role': 'user', 'content': 'hello'}],
                                  base_url='https://example.invalid', api_key='test')
    assert caught.value is exc
    assert gov.status().throttled is retryable
    assert gov.status().inflight == 0
    body = json.loads(_rate_limited_response(exc).body)
    assert body['governorReported'] is retryable
    assert body['providerCode'] == '2056'
    assert body['traceId'] == 'test-trace'


async def test_heartbeat_stops_owner_when_lease_is_lost(monkeypatch):
    lease = gov.reserve(lease_s=1)
    gov.release(lease)
    async def no_wait(*args):
        return None
    monkeypatch.setattr(gov.asyncio, 'sleep', no_wait)
    owner = asyncio.create_task(asyncio.Event().wait())
    await gov.keep_alive(lease, owner=owner)
    with pytest.raises(asyncio.CancelledError):
        await owner

@pytest.mark.parametrize('endpoint', ['llm_chat', 'agent_chat'])
@pytest.mark.parametrize('error_code', ['invalid_model_response', 'context_length_exceeded', None])
async def test_provider_repairable_error_is_structured_502(endpoint, error_code, monkeypatch):
    from fastapi import HTTPException
    from app.routers import llm as router
    exc = ValueError('invalid provider envelope')
    if error_code:
        exc.code = error_code
    async def broken(*args, **kwargs):
        raise exc
    monkeypatch.setattr(router, 'chat_completion', broken)
    body_class = router.ChatCompletionIn if endpoint == 'llm_chat' else router.AgentChatIn
    body = body_class(messages=[{'role': 'user', 'content': 'hello'}])
    with pytest.raises(HTTPException) as caught:
        await getattr(router, endpoint)(body, session=None)
    assert caught.value.status_code == (502 if error_code else 400)
    if error_code:
        assert caught.value.detail['code'] == error_code
        assert caught.value.detail['retryable'] is True


@pytest.mark.parametrize("backend", ["memory", "redis"])
def test_meta_priority_never_oversubscribes_or_bypasses_cooldown(backend, request):
    if backend == "redis":
        request.getfixturevalue("isolated_redis")
    lease = gov.reserve()
    assert lease
    assert gov.reserve(priority="pa_meta") is None
    assert not gov.slots_available(priority="pa_meta")
    gov.release(lease)
    gov.report_throttle(retry_after_s=60)
    assert gov.reserve(priority="pa_meta") is None
    assert not gov.slots_available(priority="pa_meta")

@pytest.mark.parametrize('backend', ['memory', 'redis'])
def test_provider_retry_after_is_not_shortened(backend, request, monkeypatch):
    if backend == 'redis':
        request.getfixturevalue('isolated_redis')
    monkeypatch.setattr(gov.time, 'time', lambda: 1000.0)
    gov.report_throttle(retry_after_s=120, provider_id='minimax')
    status = gov.status()
    assert status.throttle_until >= 1120
    assert status.cooldowns['minimax'] >= 1120
    gov.report_throttle(retry_after_s=5, provider_id='minimax')
    assert gov.status().throttle_until >= 1120
    assert gov.status().cooldowns['minimax'] >= 1120

@pytest.mark.parametrize('delay', [float('nan'), float('inf'), -1, 0])
def test_invalid_retry_after_uses_finite_positive_default(delay, monkeypatch):
    import math
    monkeypatch.setattr(gov.time, 'time', lambda: 1000.0)
    gov.report_throttle(retry_after_s=delay)
    until = gov.status().throttle_until
    assert math.isfinite(until)
    assert until > 1000
