"""Shared output validation and actual usage extraction for supervisor loops."""
from __future__ import annotations

import json
import re
from typing import Any

from jsonschema import Draft202012Validator


class IncompleteAgentOutput(ValueError):
    code = 'incomplete_model_output'


def validate_agent_output(response: Any) -> None:
    raw = getattr(response, 'raw', None) or {}
    choices = raw.get('choices') or []
    reason = choices[0].get('finish_reason') if choices else None
    if reason and reason not in {'stop', 'tool_calls', 'function_call'}:
        raise IncompleteAgentOutput('模型输出未完整生成，本轮未执行工具。请重试；若反复出现，请提高输出预算或缩短请求。')
    # A gateway may provide reasoning separately; reasoning alone is not a reply.
    if not (getattr(response, 'content', '') or '').strip() and not getattr(response, 'tool_calls', None):
        raise IncompleteAgentOutput('模型未返回有效回复，本轮未执行工具。请重试或缩短请求。')
    if not getattr(response, 'tool_calls', None) and re.match(
        r'^\s*<(?:tool_call|minimax:tool_call|invoke(?=\s+name\b))(?=[\s/>]|$)',
        getattr(response, 'content', '') or '', re.I,
    ):
        raise IncompleteAgentOutput('本轮不支持正文 XML 工具协议，请使用原生工具调用重试')
    if choices:
        message = choices[0].get('message') or {}
        if (message and not (message.get('content') or '').strip()
                and not message.get('tool_calls') and not getattr(response, 'tool_calls', None)):
            raise IncompleteAgentOutput('模型仅返回思考内容，未生成有效回复。本轮未执行工具，请重试。')


def validate_tool_batch(calls, tools):
    schemas = {tool['function']['name']: tool['function']['parameters'] for tool in tools}
    batch = []
    ids = set()
    for call in calls:
        fn = call.get('function') if isinstance(call, dict) else None
        if not isinstance(fn, dict) or not isinstance(fn.get('name'), str):
            raise IncompleteAgentOutput('模型工具调用格式无效')
        ident = call.get('id')
        if ident is not None:
            if not isinstance(ident, str) or not ident or ident in ids:
                raise IncompleteAgentOutput('模型工具调用 ID 无效')
            ids.add(ident)
        name, args = fn['name'], fn.get('arguments')
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except ValueError as exc:
                raise IncompleteAgentOutput('模型工具参数 JSON 不完整') from exc
        if not isinstance(args, dict) or name not in schemas or not Draft202012Validator(schemas[name]).is_valid(args):
            raise IncompleteAgentOutput(f'模型工具或参数无效：{name}')
        if name in {'invoke_tool', 'tool_invoke'}:
            target = args['name']
            if target not in schemas or target in {'invoke_tool', 'tool_invoke'} or not Draft202012Validator(schemas[target]).is_valid(args.get('args', {})):
                raise IncompleteAgentOutput(f'模型工具或参数无效：{target}')
        batch.append((name, args))
    return batch


def actual_usage(response: Any) -> dict[str, Any]:
    def field(obj: Any, key: str, default: Any = None) -> Any:
        return obj.get(key, default) if isinstance(obj, dict) else getattr(obj, key, default)

    raw = field(response, 'raw', None) or {}
    usage = field(raw, 'usage') or field(response, 'usage') or {}

    def count(attribute: str, *keys: str) -> int:
        value = field(response, attribute)
        if value is None:
            value = next((field(usage, k) for k in keys if field(usage, k) is not None), None)
        if value is None and attribute == 'cache_hit_tokens':
            value = field(field(usage, 'prompt_tokens_details', {}), 'cached_tokens', 0)
        return max(0, int(value or 0))

    return {
        'model': str(field(raw, 'model') or field(response, 'model') or 'unknown'),
        'prompt_tokens': count('prompt_tokens', 'prompt_tokens', 'input_tokens'),
        'completion_tokens': count('completion_tokens', 'completion_tokens', 'output_tokens'),
        'cache_hit_tokens': count('cache_hit_tokens', 'prompt_cache_hit_tokens', 'cache_read_input_tokens'),
        'cache_miss_tokens': count('cache_miss_tokens', 'prompt_cache_miss_tokens', 'cache_creation_input_tokens'),
    }
