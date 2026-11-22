FROM node:22-bookworm-slim AS gate-node
FROM python:3.12-slim-bookworm
COPY --from=gate-node /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-noto-cjk libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv
COPY services/api/pyproject.toml services/api/uv.lock* ./
RUN uv sync --no-dev || uv sync
COPY services/api /app
COPY services/job-worker /job-worker
COPY services/scheduler /scheduler
COPY packages /packages
RUN printf '%s\n' '{"version":1,"id":1,"function":"checkLogicAck","args":[false]}' \
    | node --experimental-strip-types /app/gate-engine/server.mjs \
    | python -c 'import json,sys; result=json.load(sys.stdin); assert result["ok"] and result["result"]["result"] == "fail"'
COPY knowledge /knowledge
ENV PYTHONPATH=/app:/job-worker:/scheduler
EXPOSE 8000
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--no-proxy-headers", "--port", "8000"]
