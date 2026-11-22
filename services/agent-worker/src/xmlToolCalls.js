/**
 * 解析模型偶发输出的 XML / 伪 JSON 工具调用（MiniMax 等）。
 * 成功返回与 OpenAI tool_calls 同形的数组；失败返回 []。
 */

function makeId() {
  return `xml_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function tryParseParamValue(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (
    (s.startsWith("{") && s.endsWith("}")) ||
    (s.startsWith("[") && s.endsWith("]")) ||
    s === "true" ||
    s === "false" ||
    /^-?\d+(\.\d+)?$/.test(s)
  ) {
    try {
      return JSON.parse(s);
    } catch {
      /* keep string */
    }
  }
  return s;
}

/** <minimax:tool_call><invoke name="..."><parameter name="...">...</parameter> */
export function parseMinimaxXmlToolCalls(content) {
  let text = String(content || "").trim();
  if (text.startsWith("<minimax:tool_call>") && text.endsWith("</minimax:tool_call>")) {
    text = text.slice("<minimax:tool_call>".length, -"</minimax:tool_call>".length).trim();
  }
  const calls = [];
  const invoke = /\s*<invoke\s+name=(["'])([^"'<>]+)\1\s*>/iy;
  const parameter = /\s*<parameter\s+name=(["'])([^"'<>]+)\1\s*>([\s\S]*?)<\/parameter>/iy;
  const close = /\s*<\/invoke>/iy;
  let end = 0;
  while (end < text.length) {
    invoke.lastIndex = end;
    const header = invoke.exec(text);
    if (!header) return [];
    end = invoke.lastIndex;
    const args = Object.create(null);
    while (true) {
      close.lastIndex = end;
      if (close.exec(text)) {
        end = close.lastIndex;
        break;
      }
      parameter.lastIndex = end;
      const item = parameter.exec(text);
      if (!item || /<\/?(?:invoke|parameter|minimax:tool_call)\b/i.test(item[3]) || Object.hasOwn(args, item[2])) return [];
      args[item[2]] = tryParseParamValue(item[3]);
      end = parameter.lastIndex;
    }
    calls.push({
      id: makeId(), type: "function",
      function: { name: header[2], arguments: JSON.stringify(args) },
    });
  }
  return calls;
}

/** <tool_call>{"name":"...","arguments":{...}}</tool_call> 或 name/args 变体 */
export function parseGenericXmlToolCalls(content) {
  const text = String(content || "").trim();
  const calls = [];
  let offset = 0;
  const opening = /\s*<tool_call>\s*/iy;
  const closing = /<\/tool_call>/ig;
  while (offset < text.length) {
    opening.lastIndex = offset;
    if (!opening.exec(text)) return [];
    const start = opening.lastIndex;
    closing.lastIndex = start;
    let match;
    let complete = false;
    // A literal closing tag inside a JSON string is part of the argument.
    // Accept a delimiter only after the entire preceding payload parses.
    while ((match = closing.exec(text))) {
      const inner = text.slice(start, match.index).trim();
      let obj;
      try {
        obj = JSON.parse(inner);
      } catch {
        if (inner.startsWith("<")) {
          const nested = parseMinimaxXmlToolCalls(inner);
          if (!nested.length) return [];
          calls.push(...nested);
        } else {
          continue;
        }
      }
      if (obj !== undefined) {
        const name = obj?.name || obj?.tool || obj?.function?.name;
        const args = obj?.arguments ?? obj?.args ?? obj?.parameters;
        if (typeof name !== "string" || !name || args == null) return [];
        calls.push({ id: makeId(), type: "function", function: {
          name, arguments: typeof args === "string" ? args : JSON.stringify(args),
        } });
      }
      offset = closing.lastIndex;
      complete = true;
      break;
    }
    if (!complete) return [];
  }
  return calls;
}

/** 从 assistant content 提取 tool_calls；无则 [] */
export function extractXmlToolCalls(content) {
  const a = parseMinimaxXmlToolCalls(content);
  if (a.length) return a;
  return parseGenericXmlToolCalls(content);
}
