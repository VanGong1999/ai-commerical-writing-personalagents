import type { IncomingMessage, ServerResponse } from 'node:http';
interface MiddlewareServer {
  middlewares: { use(handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void): unknown };
}
export function isLoopback(host?: string): boolean;
export function localUiAllowed(request: IncomingMessage): boolean;
export function localUiGuard(): {
  name: string;
  configureServer(server: MiddlewareServer): void;
  configurePreviewServer(server: MiddlewareServer): void;
};
