import http from "node:http";
import https from "node:https";
import { getConfig } from "./config.js";
import { localHeaders } from "./http.js";

export type SseHandler = (event: Record<string, unknown>) => void | boolean;

function parseApiUrl(path: string): { protocol: string; hostname: string; port: number; fullPath: string } {
  const { apiBase } = getConfig();
  const u = new URL(apiBase);
  const fullPath = `/api/v1${path.startsWith("/") ? path : `/${path}`}`;
  return {
    protocol: u.protocol,
    hostname: u.hostname,
    port: u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80,
    fullPath,
  };
}

/** Stream SSE; returns the last parsed event (typically done). */
export function streamSse(
  method: string,
  path: string,
  body: unknown | undefined,
  onEvent: SseHandler,
  timeoutMs = 560_000,
): Promise<Record<string, unknown> | null> {
  const { protocol, hostname, port, fullPath } = parseApiUrl(path);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const lib = protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const headers: Record<string, string | number> = {
      ...localHeaders(),
      Accept: "text/event-stream",
    };
    if (payload !== undefined) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }

    const req = lib.request(
      { hostname, port, path: fullPath, method, headers, timeout: timeoutMs },
      (res) => {
        if ((res.statusCode || 500) >= 400) {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            reject(
              new Error(
                `${method} ${path} -> ${res.statusCode}: ${Buffer.concat(chunks).toString("utf8").slice(0, 400)}`,
              ),
            );
          });
          return;
        }

        let buf = "";
        let last: Record<string, unknown> | null = null;
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          buf += chunk;
          const parts = buf.split("\n");
          buf = parts.pop() || "";
          for (const line of parts) {
            if (!line.startsWith("data: ")) continue;
            try {
              const ev = JSON.parse(line.slice(6)) as Record<string, unknown>;
              last = ev;
              const stop = onEvent(ev);
              if (stop === true) {
                req.destroy();
                resolve(last);
                return;
              }
            } catch {
              /* ignore partial JSON */
            }
          }
        });
        res.on("end", () => resolve(last));
      },
    );

    req.on("timeout", () => {
      req.destroy(new Error(`SSE timeout ${timeoutMs}ms`));
    });
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

export async function chatOnce(
  convId: string,
  message: string,
  projectId?: string,
  onEvent?: SseHandler,
): Promise<Record<string, unknown> | null> {
  return streamSse(
    "POST",
    `/conversations/${convId}/chat`,
    { message, projectId },
    (ev) => {
      onEvent?.(ev);
      const name = String(ev.event || "");
      return name === "done" || name === "error";
    },
  );
}

export async function watchJobEvents(
  jobId: string,
  onEvent: SseHandler,
  timeoutMs = 480_000,
): Promise<Record<string, unknown> | null> {
  return streamSse(
    "GET",
    `/jobs/${jobId}/events`,
    undefined,
    (ev) => {
      onEvent(ev);
      const name = String(ev.event || ev.type || "");
      return name === "done" || name === "error" || name === "failed";
    },
    timeoutMs,
  );
}
