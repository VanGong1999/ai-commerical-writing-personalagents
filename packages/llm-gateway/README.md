# llm-gateway

自研 OpenAI-compatible LLM 网关（Python）。

```python
from llm_gateway import LLMGateway, ChatMessage
gw = LLMGateway()
result = await gw.chat([ChatMessage(role="user", content="hi")])
```

环境变量见仓库根目录 `.env.example`（默认 `MINIMAX_*`；DeepSeek 通过
`DEEPSEEK_*` 独立保留，`OPENAI_COMPAT_*` 可接其他兼容服务）。
