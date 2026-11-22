from concurrent.futures import ThreadPoolExecutor
import json
import multiprocessing
import pytest

from app.gate_bridge import GateBridge, GateEngineError


def test_one_process_serves_repeated_and_concurrent_gate_calls():
    engine = GateBridge()
    try:
        assert engine.call('checkLengthBand', '正文' * 50, 100, 100)['result'] == 'pass'
        pid = engine.pid
        with ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(lambda _: engine.call('checkLogicAck', False), range(20)))
        assert all(result['result'] == 'fail' for result in results)
        assert engine.pid == pid
    finally:
        engine.close()


def test_unicode_gate_matches_python_codepoint_count():
    engine = GateBridge()
    try:
        assert engine.call('checkLengthBand', '😀' * 50, 100, 100)['result'] == 'fail'
    finally:
        engine.close()


def test_missing_runtime_fails_closed_without_python_business_fallback():
    with GateBridge(node='/nonexistent/gate-node') as engine:
        with pytest.raises(GateEngineError):
            engine.call('checkLogicAck', False)


def test_timeout_discards_broken_process(tmp_path):
    script = tmp_path / 'stalled.mjs'
    script.write_text('process.stdin.resume(); setInterval(() => {}, 1000);')
    with GateBridge(entry=script, timeout=0.1) as engine:
        with pytest.raises(GateEngineError, match='超时|timeout'):
            engine.call('checkLogicAck', False)
        assert engine.pid is None


def test_invalid_operation_cannot_access_arbitrary_javascript():
    with GateBridge() as engine:
        for name in ['constructor', '__proto__', 'eval']:
            with pytest.raises(GateEngineError):
                engine.call(name, 'process.exit()')
        assert engine.call('checkLogicAck', False)['result'] == 'fail'


def test_killed_process_is_not_used_for_next_call():
    with GateBridge() as engine:
        engine.call('checkLogicAck', False)
        engine._process.kill()
        engine._process.wait()
        assert engine.call('checkLogicAck', False)['result'] == 'fail'


def test_changed_rules_restart_cached_engine(tmp_path):
    script = tmp_path / 'reload.mjs'
    def write_result(value):
        script.write_text(
            "import {createInterface} from 'node:readline';"
            "for await (const line of createInterface({input:process.stdin})) {"
            "const r=JSON.parse(line);process.stdout.write(JSON.stringify("
            f"{{version:1,id:r.id,ok:true,result:{value}}})+'\\n');}}"
        )
    write_result(1)
    with GateBridge(entry=script) as engine:
        assert engine.call('test') == 1
        previous_pid = engine.pid
        write_result(200)
        assert engine.call('test') == 200
        assert engine.pid != previous_pid


def test_gate_engine_failure_is_explicit_http_503(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.routers import misc

    def unavailable(*_args, **_kwargs):
        raise GateEngineError('engine unavailable')

    monkeypatch.setattr(misc, 'check_prompt_lock', unavailable)
    # No lifespan/database/queues are required for deterministic validation.
    response = TestClient(app, raise_server_exceptions=False).post(
        '/api/v1/prompts/validate',
        json={'lockedSystem':'LOCK', 'lockedHash':'hash',
              'editableInstruction':'写作', 'requiredPhrases':[]},
    )
    assert response.status_code == 503
    assert response.json()['detail']['code'] == 'gate_engine_unavailable'


@pytest.mark.parametrize('response', [
    'not json', '[]',
    '{"version":1,"id":999,"ok":true,"result":true}',
    '{"version":1,"id":1,"ok":true}',
    '{"version":1,"id":1,"ok":false,"error":"invalid error"}',
])
def test_malformed_protocol_never_passes_and_discards_process(tmp_path, response):
    script = tmp_path / 'invalid.mjs'
    script.write_text(
        "import {createInterface} from 'node:readline';"
        "for await (const line of createInterface({input:process.stdin})) "
        f"process.stdout.write({json.dumps(response)}+'\\n');"
    )
    with GateBridge(entry=script) as engine:
        with pytest.raises(GateEngineError):
            engine.call('test')
        assert engine.pid is None


@pytest.mark.skipif('fork' not in multiprocessing.get_all_start_methods(), reason='requires fork')
def test_fork_uses_separate_engine_and_keeps_parent_alive():
    context = multiprocessing.get_context('fork')
    receiver, sender = context.Pipe(duplex=False)
    with GateBridge() as engine:
        engine.call('checkLogicAck', False)
        parent_pid = engine.pid

        def child_call():
            try:
                result = engine.call('checkLogicAck', False)
                sender.send((engine.pid, result['result']))
            finally:
                engine.close()
                sender.close()

        child = context.Process(target=child_call)
        child.start()
        sender.close()
        try:
            assert receiver.poll(5), 'forked gate engine did not respond'
            child_pid, result = receiver.recv()
            assert child_pid != parent_pid
            assert result == 'fail'
            child.join(5)
            assert child.exitcode == 0
            assert engine.call('checkLogicAck', False)['result'] == 'fail'
            assert engine.pid == parent_pid
        finally:
            if child.is_alive():
                child.kill()
                child.join(5)
            receiver.close()
