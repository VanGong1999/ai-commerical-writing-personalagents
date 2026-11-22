"""Single-user local service boundary; never trust proxy identity headers."""
import hmac
import ipaddress
from urllib.parse import urlsplit

from starlette.datastructures import Headers
from starlette.responses import JSONResponse


def is_loopback(host: str) -> bool:
    try:
        address = ipaddress.ip_address(host)
        return address.is_loopback or bool(getattr(address, 'ipv4_mapped', None) and address.ipv4_mapped.is_loopback)
    except ValueError:
        return False


def local_host(value: str) -> bool:
    try:
        host = urlsplit('//' + value).hostname
        return host == 'localhost' or bool(host and is_loopback(host))
    except ValueError:
        return False


class LocalAccessMiddleware:
    def __init__(self, app, settings):
        self.app = app
        self.settings = settings
        if settings.local_api_require_token and len(settings.local_api_token) < 32:
            raise RuntimeError('LOCAL_API_REQUIRE_TOKEN requires LOCAL_API_TOKEN of at least 32 characters')

    async def __call__(self, scope, receive, send):
        if scope['type'] not in ('http', 'websocket'):
            return await self.app(scope, receive, send)
        headers = Headers(scope=scope)
        expected = self.settings.local_api_token
        supplied = headers.get('x-xzm-local-token', '')
        authenticated = bool(len(expected) >= 32 and hmac.compare_digest(expected.encode(), supplied.encode()))
        peer = (scope.get('client') or ('', 0))[0]
        permitted = authenticated or (
            not self.settings.local_api_require_token and is_loopback(peer)
            and local_host(headers.get('host', ''))
        )
        # CORS alone does not stop form submissions or reads with side effects.
        # Apply browser-origin checks even to requests carrying a service token.
        origin = headers.get('origin')
        if origin is not None and origin not in self.settings.cors_origins:
            permitted = False
        if headers.get('sec-fetch-site') == 'cross-site':
            permitted = False
        if not permitted:
            if scope['type'] == 'websocket':
                return await send({'type':'websocket.close', 'code':1008})
            return await JSONResponse({'detail':{'code':'local_access_denied',
                'message':'仅允许本机访问或已认证的内部服务。'}}, status_code=403)(scope, receive, send)
        return await self.app(scope, receive, send)
