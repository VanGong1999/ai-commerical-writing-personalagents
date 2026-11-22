import { isIP } from 'node:net';

export function isLoopback(host = '') {
  return host === '::1' || (isIP(host) === 4 && host.startsWith('127.')) ||
    (host.startsWith('::ffff:') && isLoopback(host.slice(7)));
}

export function localUiAllowed(request) {
  if (!isLoopback(request.socket.remoteAddress)) return false;
  try {
    const host = new URL(`http://${request.headers.host}`).hostname;
    if (host !== 'localhost' && !isLoopback(host.replace(/^\[|\]$/g, ''))) return false;
    if (request.headers['sec-fetch-site'] === 'cross-site') return false;
    if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) return false;
    return true;
  } catch { return false; }
}

// Runs ahead of Vite's proxy, including preview and an accidental --host override.
export function localUiGuard() {
  const install = server => {
    server.middlewares.use((request, response, next) => {
      if (localUiAllowed(request)) return next();
      response.statusCode = 403;
      response.end('Local access only');
    });
  };
  return { name:'xzm-local-only', configureServer:install, configurePreviewServer:install };
}
