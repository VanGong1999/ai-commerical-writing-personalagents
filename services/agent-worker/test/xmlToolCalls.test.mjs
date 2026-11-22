import assert from "node:assert/strict";
import { test } from "node:test";
import { extractXmlToolCalls } from "../src/xmlToolCalls.js";

test("解析 minimax invoke XML", () => {
  const content = `<minimax:tool_call>
<invoke name="gate_run">
<parameter name="name">LengthBand</parameter>
<parameter name="payload">{"text":"hi","minChars":1}</parameter>
</invoke>
</minimax:tool_call>`;
  const calls = extractXmlToolCalls(content);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, "gate_run");
  const args = JSON.parse(calls[0].function.arguments);
  assert.equal(args.name, "LengthBand");
  assert.equal(args.payload.text, "hi");
});

test("解析 generic tool_call JSON", () => {
  const content = `<tool_call>{"name":"artifact_list","arguments":{"type":"outline"}}</tool_call>`;
  const calls = extractXmlToolCalls(content);
  assert.equal(calls[0].function.name, "artifact_list");
  assert.equal(JSON.parse(calls[0].function.arguments).type, "outline");
});

test('generic XML preserves malformed argument text for rejection instead of substituting empty args', () => {
 const calls=extractXmlToolCalls('<tool_call>{"name":"delete_all","arguments":"{broken"}</tool_call>');
 assert.equal(calls[0].function.arguments,'{broken');
});

test('partial XML parameters never become executable empty arguments',()=>{
 assert.deepEqual(extractXmlToolCalls('<minimax:tool_call><invoke name="delete_all"><parameter name="id">partial</invoke></minimax:tool_call>'),[]);
});

test("only complete standalone batches become calls", () => {
  const call = '<tool_call>{"name":"demo","arguments":{}}</tool_call>';
  for (const content of [call + "<tool_call>", "示例：" + call, call + " trailing"]) {
    assert.deepEqual(extractXmlToolCalls(content), []);
  }
});

test("generic XML accepts literal closing tags inside JSON strings", () => {
  const payload = {name: "save", arguments: {content: "示例 </tool_call>"}};
  const calls = extractXmlToolCalls("<tool_call>" + JSON.stringify(payload) + "</tool_call>");
  assert.deepEqual(JSON.parse(calls[0].function.arguments), payload.arguments);
});
