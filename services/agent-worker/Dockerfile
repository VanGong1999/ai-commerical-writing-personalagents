FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages ./packages
COPY services/agent-worker ./services/agent-worker
RUN pnpm install --filter @xiezuomanju/agent-worker... --frozen-lockfile || pnpm install --filter @xiezuomanju/agent-worker...
WORKDIR /app/services/agent-worker
ENV JOB_AGENT_QUEUE_KEY=jobs:agent
CMD ["pnpm", "start"]
