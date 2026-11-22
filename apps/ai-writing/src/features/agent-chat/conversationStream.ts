import type { RunStepItem } from "../../api/client";

export function mergeSteps(previous: RunStepItem[], incoming: RunStepItem[]): RunStepItem[] {
  const byId = new Map(previous.map((s) => [s.id, s]));
  for (const step of incoming) byId.set(step.id, step);
  return [...byId.values()].sort((a, b) => a.seq - b.seq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function waitForReconnect(delay: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      globalThis.window?.removeEventListener("online", finish);
      resolve();
    }
    if (globalThis.window && !navigator.onLine) {
      // Save the retry budget while the device is offline.
      window.addEventListener("online", finish, { once: true });
    } else {
      timer = setTimeout(finish, delay);
    }
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}

type StreamEvent = Record<string, unknown>;

export async function watchConversation(
  url: string, signal: AbortSignal, consume: (event: StreamEvent) => void,
) {
  const cursor = new URLSearchParams();
  let failures = 0;
  while (!signal.aborted && failures < 8) {
    try {
      const res = await fetch(`${url}?${cursor}`, { headers: { Accept: "text/event-stream" }, signal });
      if ([400, 401, 403, 404].includes(res.status)) return;
      if (!res.ok || !res.body) throw new Error(`Stream HTTP ${res.status}`);
      const connectedAt = Date.now();
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (!signal.aborted) {
          const { done, value } = await reader.read();
          if (done || signal.aborted) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary: number;
          while ((boundary = buffer.indexOf("\n\n")) >= 0) {
            const chunk = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = chunk.split("\n").filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart()).join("\n");
            if (!data) continue;
            const event = JSON.parse(data) as StreamEvent;
            if (event.event === "step") {
              if (typeof event.id !== "string" || !event.id || typeof event.seq !== "number" ||
                  !Number.isSafeInteger(event.seq)) throw new Error("Invalid step cursor");
              const lastId = cursor.get("after_id");
              const lastSeq = Number(cursor.get("after_seq"));
              // The server orders IDs using the database collation. Compare the
              // actual position for progress without reordering or dropping rows.
              consume(event);
              if (event.seq !== lastSeq || event.id !== lastId) failures = 0;
              cursor.set("after_seq", String(event.seq));
              cursor.set("after_id", event.id);
            } else {
              consume(event);
            }
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
        // Short connections routinely deliver a runtime snapshot and ping.
        if (Date.now() - connectedAt >= 30_000) failures = 0;
      }
    } catch {
      // EOF and interrupted reads both resume from the last complete event.
    }
    if (signal.aborted || ++failures >= 8) return;
    await waitForReconnect(Math.min(8000, 250 * 2 ** (failures - 1)), signal);
  }
}
