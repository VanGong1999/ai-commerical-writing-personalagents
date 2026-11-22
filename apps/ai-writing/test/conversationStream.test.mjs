import assert from "node:assert/strict";
import test from "node:test";
import { mergeSteps, watchConversation } from "../src/features/agent-chat/conversationStream.ts";

test("EOF and read failure reconnect with the last complete server step including seq zero", async (t) => {
  const abort = new AbortController();
  const calls = [];
  const step = (id) => `data: ${JSON.stringify({ event: "step", id, seq: 0 })}\n\n`;
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(new URL(url).searchParams);
    if (calls.length === 1) return new Response(step("a") + "data: {");
    if (calls.length === 2) throw new TypeError("connection interrupted");
    return new Response(step("b"));
  });
  const raw = [];
  await watchConversation("http://test.invalid/stream", abort.signal, (event) => {
    raw.push(event.id);
    if (event.id === "b") abort.abort();
  });
  assert.deepEqual(raw, ["a", "b"]);
  assert.deepEqual(calls.map((p) => [...p]), [[], ...Array(2).fill([["after_seq","0"],["after_id","a"]])]);
  const rows = mergeSteps([{ id: "b", seq: 0 }], [{ id: "a", seq: 0 }, { id: "b", seq: 0 }]);
  assert.deepEqual(rows.map((x) => x.id), raw);
});

test("changing conversation aborts a pending reconnect and clears its cursor", async (t) => {
  const urls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    urls.push(url);
    return new Response(url.includes("/old") ? "" : null, {status: url.includes("/old") ? 200 : 403});
  });
  const old = new AbortController();
  const end = watchConversation("http://test.invalid/old", old.signal, assert.fail);
  await new Promise((r) => setTimeout(r, 20));
  old.abort();
  await end;
  await watchConversation("http://test.invalid/new", new AbortController().signal, assert.fail);
  assert.deepEqual(urls, ["http://test.invalid/old?", "http://test.invalid/new?"]);
});

test("consecutive connection failures stop at eight attempts with capped backoff", async (t) => {
  const delays = [];
  let attempts = 0;
  t.mock.method(globalThis, "fetch", async () => { attempts++; throw new TypeError("disconnected"); });
  t.mock.method(globalThis, "setTimeout", (fn, delay) => {
    delays.push(delay);
    queueMicrotask(fn);
    return 0;
  });
  await watchConversation("http://test.invalid", new AbortController().signal, assert.fail);
  assert.equal(attempts, 8);
  assert.deepEqual(delays, [250, 500, 1000, 2000, 4000, 8000, 8000]);
});

for (const stable of [false, true]) {
  test(`heartbeat-only EOF counts against the budget; a stable connection resets it (${stable})`, async (t) => {
    let requests = 0, clock = 0;
    const delays = [];
    t.mock.method(Date, "now", () => clock);
    t.mock.method(globalThis, "setTimeout", (fn, delay) => {
      delays.push(delay);
      queueMicrotask(fn);
      return 0;
    });
    t.mock.method(globalThis, "fetch", async () => {
      if (++requests > (stable ? 8 : 10)) return new Response(null, { status: 403 });
      return new Response('data: {"event":"runtime"}\n\ndata: {"event":"ping","seq":0}\n\n');
    });
    await watchConversation("http://test.invalid/stream", new AbortController().signal, (event) => {
      if (stable && requests === 8 && event.event === "ping") clock += 600_000;
    });
    assert.equal(requests, stable ? 9 : 8);
    assert.deepEqual(delays, [250, 500, 1000, 2000, 4000, 8000, 8000, ...(stable ? [250] : [])]);
  });
}
