import { getConfig } from "./config.js";

export function localHeaders(): Record<string, string> {
  return process.env.LOCAL_API_TOKEN ? { "X-XZM-Local-Token": process.env.LOCAL_API_TOKEN } : {};
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  opts: { raw?: boolean; accept?: string } = {},
): Promise<T> {
  const { apiBase } = getConfig();
  const url = `${apiBase}/api/v1${path.startsWith("/") ? path : `/${path}`}`;
  let lastErr: unknown = null;

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const headers: Record<string, string> = localHeaders();
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (opts.accept) headers.Accept = opts.accept;

      const res = await fetch(url, {
        method,
        headers: Object.keys(headers).length ? headers : undefined,
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        if (res.status >= 500 && attempt < 3) {
          await sleep(800 * (attempt + 1));
          continue;
        }
        throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
      }

      if (opts.raw) return res as unknown as T;
      if (res.status === 204) return undefined as T;
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) return (await res.json()) as T;
      return (await res.text()) as T;
    } catch (err) {
      lastErr = err;
      const msg = String((err as Error)?.message || err);
      if (
        /UND_ERR_SOCKET|ECONNREFUSED|ECONNRESET|fetch failed|other side closed/i.test(msg) &&
        attempt < 3
      ) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error(`${method} ${path} failed`);
}

/** Root health is outside /api/v1 */
export async function rootHealth(): Promise<unknown> {
  const { apiBase } = getConfig();
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${apiBase}/health`, { headers: localHeaders() });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`GET /health -> ${res.status}: ${text.slice(0, 200)}`);
      }
      return res.json();
    } catch (err) {
      lastErr = err;
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastErr;
}

/** Multipart/form-data POST (e.g. KB upload). Query string goes in path. */
export async function apiForm<T = unknown>(path: string, form: FormData): Promise<T> {
  const { apiBase } = getConfig();
  const url = `${apiBase}/api/v1${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, { method: "POST", headers: localHeaders(), body: form });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  }
  return (await res.json()) as T;
}

export async function apiBinary(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ buffer: Buffer; contentType: string; filename?: string }> {
  const { apiBase } = getConfig();
  const url = `${apiBase}/api/v1${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    method,
    headers: { ...localHeaders(), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  }
  const ab = await res.arrayBuffer();
  const cd = res.headers.get("content-disposition") || "";
  const m = /filename\*?=(?:UTF-8'')?\"?([^\";]+)/i.exec(cd);
  return {
    buffer: Buffer.from(ab),
    contentType: res.headers.get("content-type") || "application/octet-stream",
    filename: m ? decodeURIComponent(m[1]) : undefined,
  };
}
