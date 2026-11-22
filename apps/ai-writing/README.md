# ai-writing

主 Web 应用。只接真实 API（见 `.env.example`：`VITE_API_BASE`），无 mock 模式。

```bash
# 先起 API：pnpm dev:api
pnpm --filter @xiezuomanju/ai-writing dev
```

前端直连 FastAPI；没有后端时页面会如实报错，不再返回演示数据。
