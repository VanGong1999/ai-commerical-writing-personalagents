import type { ContextRef } from "../features/references/selection";
/** Job SSE helpers for `/api/v1/jobs/{id}/events`. */

const base = (import.meta.env.VITE_API_BASE as string) || "";

export type JobEvent = {
  type: string;
  status?: string;
  jobId?: string;
  runId?: string;
  message?: string;
  token?: string;
  text?: string;
  [key: string]: unknown;
};

export function jobEventsUrl(jobId: string): string {
  return `${base}/api/v1/jobs/${encodeURIComponent(jobId)}/events`;
}

/** Browser EventSource subscription; returns an unsubscribe function. */
export function subscribeJobEvents(
  jobId: string,
  handlers: {
    onEvent: (event: JobEvent) => void;
    onError?: (err: Event) => void;
    onDone?: (event: JobEvent) => void;
  },
): () => void {
  const es = new EventSource(jobEventsUrl(jobId));

  es.onmessage = (msg) => {
    let data: JobEvent;
    try {
      data = JSON.parse(msg.data) as JobEvent;
    } catch {
      data = { type: "raw", message: msg.data };
    }
    handlers.onEvent(data);
    if (data.type === "done" || data.status === "succeeded" || data.status === "failed" || data.status === "cancelled") {
      handlers.onDone?.(data);
      es.close();
    }
  };

  es.onerror = (err) => {
    handlers.onError?.(err);
  };

  return () => es.close();
}

/**
 * Fetch-based SSE stream as AsyncIterable (works when EventSource is unavailable
 * or when you need AbortSignal cancellation).
 */
export async function* streamJobEvents(
  jobId: string,
  signal?: AbortSignal,
): AsyncGenerator<JobEvent, void, undefined> {
  const res = await fetch(jobEventsUrl(jobId), {
    headers: { Accept: "text/event-stream" },
    signal,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail || res.statusText);
  }
  if (!res.body) {
    throw new Error("SSE response has no body");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) >= 0) {
        const chunk = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const event = parseSseChunk(chunk);
        if (!event) continue;
        yield event;
        if (
          event.type === "done" ||
          event.status === "succeeded" ||
          event.status === "failed" ||
          event.status === "cancelled" ||
          event.status === "dead"
        ) {
          return;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSseChunk(chunk: string): JobEvent | null {
  const dataLines: string[] = [];
  for (const line of chunk.split("\n")) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (!dataLines.length) return null;
  const raw = dataLines.join("\n");
  try {
    return JSON.parse(raw) as JobEvent;
  } catch {
    return { type: "raw", message: raw };
  }
}

export type ConversationChatEvent = {
  event: string;
  [key: string]: unknown;
};

/**
 * Personal Agent 对话流（POST + SSE）：把 supervisor 的 plan/tool_call/confirm/done
 * 事件逐条 yield 出来。
 */
export async function* streamConversationChat(
  conversationId: string,
  body: {
    message: string;
    clientMessageId?: string;
    projectId?: string;
    mentionBotIds?: string[];
    forceContinue?: boolean;
    contextRefs?: ContextRef[];
  },
  signal?: AbortSignal,
): AsyncGenerator<ConversationChatEvent, void, undefined> {
  const res = await fetch(`${base}/api/v1/conversations/${encodeURIComponent(conversationId)}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      message: body.message,
      clientMessageId: body.clientMessageId,
      projectId: body.projectId,
      mentionBotIds: body.mentionBotIds,
      forceContinue: body.forceContinue,
      contextRefs: body.contextRefs,
    }),
    signal,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail || res.statusText);
  }
  if (!res.body) throw new Error("SSE response has no body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) >= 0) {
        const chunk = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const dataLines: string[] = [];
        for (const line of chunk.split("\n")) {
          if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
        }
        if (!dataLines.length) continue;
        let evt: ConversationChatEvent;
        try {
          evt = JSON.parse(dataLines.join("\n")) as ConversationChatEvent;
        } catch {
          evt = { event: "raw", message: dataLines.join("\n") };
        }
        yield evt;
        if (evt.event === "done" || evt.event === "error" || evt.event === "confirm") {
          return;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
