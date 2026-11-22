/**
 * 会话持久性
 * 「The log is the agent」——规范化事件日志，崩溃后可忠实恢复。
 */

import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type SessionEventType =
  | "run_start"
  | "private_working_context"
  | "model_call"
  | "thinking"
  | "reply"
  | "tool_call"
  | "tool_result"
  | "gate"
  | "compaction"
  | "done_check"
  | "repair"
  | "receipt"
  | "error"
  | "run_end"
  | "policy"
  | "handoff"
  | "subagent"
  | "ledger"
  | "context"
  | "checkpoint"
  | "heartbeat";

export type SessionEvent = {
  ts: string;
  type: SessionEventType;
  runId: string;
  agentId?: string;
  payload?: Record<string, unknown>;
};

export type SessionStore = {
  append: (event: SessionEvent) => void;
  readAll: (options?: {privateWorkingContext?: boolean}) => SessionEvent[];
  path: string;
};

function safeParseLine(line: string): SessionEvent | null {
  const t = line.trim();
  if (!t) return null;
  try {
    return JSON.parse(t) as SessionEvent;
  } catch {
    // 崩溃截断行：丢弃（Py 策略）
    return null;
  }
}

export function createJsonlSessionStore(filePath: string): SessionStore {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(filePath)) writeFileSync(filePath, "", {encoding:"utf8", mode:0o600, flag:"a"});

  return {
    path: filePath,
    append(event: SessionEvent) {
      // 写前落盘：Hermes 风格「API 调用前也记」由调用方保证时序
      if (event.type === "private_working_context") chmodSync(filePath, 0o600);
      appendFileSync(filePath, `${JSON.stringify(event)}\n`, "utf8");
    },
    readAll(options) {
      const raw = readFileSync(filePath, "utf8");
      const out: SessionEvent[] = [];
      for (const line of raw.split("\n")) {
        const ev = safeParseLine(line);
        if (ev && (options?.privateWorkingContext || ev.type !== "private_working_context")) out.push(ev);
      }
      return out;
    },
  };
}

export function defaultSessionPath(root: string, runId: string): string {
  return join(root, "sessions", `${runId}.jsonl`);
}

export function emit(
  store: SessionStore | undefined,
  partial: Omit<SessionEvent, "ts"> & { ts?: string },
): SessionEvent {
  const event: SessionEvent = {
    ts: partial.ts || new Date().toISOString(),
    type: partial.type,
    runId: partial.runId,
    agentId: partial.agentId,
    payload: partial.payload,
  };
  store?.append(event);
  return event;
}

/** 从日志恢复：返回是否需要 operator 介入（in_doubt） */
export function inspectCrashBoundary(events: SessionEvent[]): {
  lastType?: SessionEventType;
  inDoubt: boolean;
  reason?: string;
  pendingToolCall?: unknown;
} {
  if (!events.length) return { inDoubt: false };
  const last = events[events.length - 1];
  if (last.type === "tool_call") {
    return {
      lastType: last.type,
      inDoubt: true,
      reason: "崩溃于 tool_call 之后、tool_result 之前：副作用存疑，禁止盲重试",
      pendingToolCall: last.payload,
    };
  }
  if (
    last.type === "model_call" ||
    last.type === "thinking" ||
    last.type === "reply"
  ) {
    return {
      lastType: last.type,
      inDoubt: true,
      reason: "崩溃于模型调用/回复之后、无工具副作用：可安全重试模型调用",
      pendingToolCall: last.payload,
    };
  }
  if (last.type === "run_end" || last.type === "receipt") {
    return { lastType: last.type, inDoubt: false };
  }
  return { lastType: last.type, inDoubt: false };
}
