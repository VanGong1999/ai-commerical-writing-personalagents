/**
 * OpenTelemetry 轻量封装：默认关闭；AGENT_OTEL_ENABLED=true 时启用。
 * 无 collector / 缺依赖时降级为 no-op，不阻断 worker。
 * withSpan 使用 context.with 建立父子 span，便于 Fleet/嵌套链路关联。
 */

let tracer = null;
let otelApi = null;
let enabled = false;

const noopSpan = {
  setAttribute() {
    return this;
  },
  setStatus() {
    return this;
  },
  recordException() {},
  end() {},
  isRecording() {
    return false;
  },
  spanContext() {
    return { traceId: "", spanId: "", traceFlags: 0 };
  },
};

export async function initOtel() {
  enabled = String(process.env.AGENT_OTEL_ENABLED || "").toLowerCase() === "true";
  if (!enabled) {
    tracer = { startSpan: () => noopSpan };
    return { enabled: false };
  }
  try {
    const api = await import("@opentelemetry/api");
    otelApi = api;
    try {
      const { NodeSDK } = await import("@opentelemetry/sdk-node");
      const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
      const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "";
      const exporter = endpoint
        ? new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, "")}/v1/traces` })
        : undefined;
      const sdk = new NodeSDK({
        serviceName: process.env.OTEL_SERVICE_NAME || "xiezuomanju-agent-worker",
        traceExporter: exporter,
      });
      await sdk.start();
      console.log(
        "[otel] started",
        endpoint ? `otlp=${endpoint}` : "(no OTEL_EXPORTER_OTLP_ENDPOINT; spans in-process only)",
      );
    } catch (err) {
      console.warn("[otel] SDK init skipped:", err.message);
    }
    tracer = api.trace.getTracer("agent-worker", "0.1.0");
    return { enabled: true };
  } catch (err) {
    console.warn("[otel] @opentelemetry/api unavailable, no-op:", err.message);
    tracer = { startSpan: () => noopSpan };
    return { enabled: false };
  }
}

export function startSpan(name, attrs = {}) {
  if (!tracer) tracer = { startSpan: () => noopSpan };
  const span = tracer.startSpan(name);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null) span.setAttribute(k, typeof v === "object" ? JSON.stringify(v) : v);
  }
  return span;
}

/**
 * 在当前 active context 下开启子 span，并在 fn 执行期间设为 active。
 * 这样 model_call / tool_call 会挂到 agent.run 之下。
 */
export function withSpan(name, attrs, fn) {
  if (!tracer) tracer = { startSpan: () => noopSpan };

  if (otelApi?.trace?.setSpan && otelApi?.context?.with) {
    const parentCtx = otelApi.context.active();
    const span = tracer.startSpan(name, undefined, parentCtx);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v !== undefined && v !== null) span.setAttribute(k, typeof v === "object" ? JSON.stringify(v) : v);
    }
    const ctx = otelApi.trace.setSpan(parentCtx, span);
    return otelApi.context.with(ctx, () =>
      Promise.resolve()
        .then(() => fn(span))
        .catch((err) => {
          span.recordException?.(err);
          span.setStatus?.({ code: 2, message: err?.message || String(err) });
          throw err;
        })
        .finally(() => span.end()),
    );
  }

  const span = startSpan(name, attrs);
  return Promise.resolve()
    .then(() => fn(span))
    .catch((err) => {
      span.recordException?.(err);
      span.setStatus?.({ code: 2, message: err.message });
      throw err;
    })
    .finally(() => span.end());
}

/**
 * 将已有 span 设为 active 后执行（用于 agent.run 根 span 包裹整段逻辑）。
 */
export function withExistingSpan(span, fn) {
  if (otelApi?.trace?.setSpan && otelApi?.context?.with && span) {
    const ctx = otelApi.trace.setSpan(otelApi.context.active(), span);
    return otelApi.context.with(ctx, () => Promise.resolve().then(() => fn(span)));
  }
  return Promise.resolve().then(() => fn(span));
}

export function isOtelEnabled() {
  return enabled;
}
