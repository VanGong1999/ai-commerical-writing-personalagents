from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from app.local_access import LocalAccessMiddleware
from app.settings import Settings

TOKEN = 'test-secret-' * 4

def client(peer='127.0.0.1', host='127.0.0.1', required=False):
    app = FastAPI()
    app.add_middleware(LocalAccessMiddleware, settings=Settings(
        _env_file=None, local_api_token=TOKEN, local_api_require_token=required))
    @app.api_route('/sensitive', methods=['GET', 'POST'])
    def sensitive():
        return {'ok':True}
    return TestClient(app, client=(peer, 1234), base_url=f'http://{host}')

@pytest.mark.parametrize('peer', ['127.0.0.1', '::1', '::ffff:127.0.0.1'])
def test_loopback_works(peer):
    assert client(peer).get('/sensitive').status_code == 200

@pytest.mark.parametrize('peer', ['192.168.1.20', '172.18.0.1', '8.8.8.8'])
@pytest.mark.parametrize('method', ['get','post'])
def test_remote_cannot_spoof_local_address(peer, method):
    response = getattr(client(peer), method)('/sensitive', headers={
        'X-Forwarded-For':'127.0.0.1', 'Forwarded':'for=127.0.0.1', 'X-Real-IP':'127.0.0.1'})
    assert response.status_code == 403

def test_rebinding_host_denied():
    assert client(host='attacker.example').get('/sensitive').status_code == 403

@pytest.mark.parametrize('headers', [
    {'Origin':'https://attacker.example'}, {'Origin':'null'},
    {'Sec-Fetch-Site':'cross-site'},
])
def test_cross_site_blocked_even_with_token(headers):
    headers['X-XZM-Local-Token'] = TOKEN
    assert client().post('/sensitive', headers=headers).status_code == 403

def test_browser_ui_origin_allowed():
    assert client().post('/sensitive', headers={'Origin':'http://localhost:5173'}).status_code == 200

def test_docker_requires_token_even_when_proxy_appears_local():
    c = client(required=True)
    assert c.get('/sensitive').status_code == 403
    assert c.get('/sensitive', headers={'X-XZM-Local-Token':TOKEN}).status_code == 200
    assert c.get('/sensitive', headers={'X-XZM-Local-Token':'wrong'}).status_code == 403

def test_authenticated_container_worker_allowed():
    assert client('172.18.0.3', 'api', True).post('/sensitive', headers={
        'X-XZM-Local-Token':TOKEN}).status_code == 200

def test_strict_mode_without_strong_secret_fails_closed():
    app = FastAPI()
    app.add_middleware(LocalAccessMiddleware, settings=Settings(
        _env_file=None, local_api_require_token=True, local_api_token=''))
    with pytest.raises(RuntimeError, match='LOCAL_API_TOKEN'):
        TestClient(app).get('/')

def test_actual_app_protects_sensitive_route_before_handler():
    from app.main import app
    c = TestClient(app, client=('192.168.1.99', 4567), base_url='http://127.0.0.1')
    assert c.post('/api/v1/prompts/validate', json={}).status_code == 403
