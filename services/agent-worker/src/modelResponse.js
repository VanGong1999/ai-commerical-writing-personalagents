import { estimateTokens } from '@xiezuomanju/agent-runtime';
import { normalizeToolName } from './toolNames.js';
import { extractXmlToolCalls } from './xmlToolCalls.js';

/** Validate the entire response before exposing or executing any candidate. */
export function assertCompleteModelResponse(completion, validateCall) {
  const choice = completion?.choices?.[0];
  const message = choice?.message;
  if (['length', 'max_tokens', 'content_filter'].includes(choice?.finish_reason)) {
    throw new Error('模型输出被截断或过滤，未执行本轮工具；请缩小单次任务或调整输出预算后重试');
  }
  if (choice?.finish_reason !== undefined && !['stop', 'tool_calls', 'function_call'].includes(choice.finish_reason)) {
    throw new Error('模型未正常结束，未执行本轮工具；请重试');
  }
  if (message?.content != null && typeof message.content !== "string") throw new Error("模型正文格式错误，必须返回文本");
  if (!message || (!String(message.content || '').trim() && !(message.tool_calls || []).length)) {
    throw new Error('模型没有返回可用正文或工具调用，未将任务标记为完成；请重试');
  }
  if (message.tool_calls != null) {
    const ids = new Set();
    if (!Array.isArray(message.tool_calls)) throw new Error('模型工具调用格式错误');
    for (const call of message.tool_calls) {
      if (typeof call?.id !== "string" || !call.id || ids.has(call.id) || typeof call.function?.name !== "string" || !call.function.name || !['string', 'object'].includes(typeof call.function.arguments) || call.function.arguments == null) throw new Error('模型工具调用格式错误，请返回完整 id、function.name 与 arguments');
      ids.add(call.id);
    }
  }
  const content = String(message.content || '').trimStart();
  const xml = !message.tool_calls?.length && /^<(?:tool_call|minimax:tool_call|invoke(?=\s+name\b))(?=[\s/>]|$)/i.test(content);
  const dsml = !message.tool_calls?.length && /^<\s*[|｜]*\s*DSML\s*[|｜]*\s*(?:function_calls|invoke)(?=[\s/>]|$)/i.test(content);
  if (dsml) throw new Error('本轮不支持正文 DSML 工具协议，请重发原生工具调用');
  const calls = message.tool_calls?.length ? message.tool_calls : extractXmlToolCalls(content);
  if (xml && !calls.length) throw new Error('模型工具调用 XML 不完整，请重发完整工具调用');
  for (const call of calls) {
    const raw = call.function.arguments;
    const args = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('工具参数必须是 JSON 对象');
    const name = normalizeToolName(call.function.name);
    validateCall?.(name, args);
    if (name === 'tool_invoke') validateCall?.(normalizeToolName(args.name), args.args);
  }
}

const overflowError = error => /context[_ -](?:length[_ -]exceeded|window)|maximum context length|input (?:is too long|exceeds.*tokens)|too many (?:input )?tokens|request_too_large/i.test(String(error?.code || '') + ' ' + String(error?.message || ''));

/** Recovery stays inside the current turn; completed actions are never replayed.
 * Each rejected candidate is withheld, billed, then replaced by a fresh response.
 */
export async function requestModelWithRecovery({ request, messages, compact, onCompletion, onRepair, validateCall, signal, maxRepairs = 2 }) {
  let repairs = 0;
  let overflows = 0;
  const repair = async error => {
    repairs++;
    messages.push({ role: 'user', content: `【模型协议修复】${error.message}。本次候选输出未执行任何工具。请保留原任务与约束，重发完整的正文或原生工具调用；不要输出私有推理代替答案。缩小单次工具参数，禁止补猜缺失参数。` });
    await onRepair?.({ reason: 'model_response', attempt: repairs });
  };
  for (;;) {
    if (signal?.aborted) throw signal.reason || new Error('cancelled');
    let completion;
    try { completion = await request(); }
    catch (error) {
      if (!signal?.aborted && error?.code === 'invalid_model_response' && repairs < maxRepairs) {
        await repair(error);
        continue;
      }
      if (error?.code === 'invalid_model_response' && repairs >= maxRepairs) error.retryable = false;
      if (signal?.aborted || !overflowError(error)) throw error;
      if (!compact || overflows >= 2) throw Object.assign(error, {retryable:false});
      const before = estimateTokens(messages);
      overflows++;
      await onRepair?.({ reason: 'context_overflow', attempt: overflows, before });
      const reduced = await compact();
      const after = estimateTokens(reduced);
      if (after >= before || before - after < Math.min(128, before * 0.05)) throw Object.assign(error, {retryable:false});
      messages.splice(0, messages.length, ...reduced);
      continue;
    }
    await onCompletion?.(completion);
    try { assertCompleteModelResponse(completion, validateCall); return completion; }
    catch (error) {
      // Filtering is terminal; repeated malformed output gets a bounded failure.
      if (completion?.choices?.[0]?.finish_reason === 'content_filter' || repairs >= maxRepairs) throw Object.assign(error, {retryable:false});
      await repair(error);
    }
  }
}
