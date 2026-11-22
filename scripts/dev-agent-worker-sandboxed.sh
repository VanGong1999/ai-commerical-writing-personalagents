#!/usr/bin/env bash
# 在 macOS 系统沙箱内启动 agent-worker（OS 级 jail 开关）。
# 用法：pnpm dev:agent-worker:sandboxed
set -euo pipefail

if ! command -v sandbox-exec >/dev/null 2>&1; then
  echo "sandbox-exec 不可用（非 macOS 或已移除）；跳过 OS 级沙箱，按普通方式启动。" >&2
  exec pnpm --filter @xiezuomanju/agent-worker start
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$REPO_ROOT/services/agent-worker/sandbox-agent-worker.sb"
PROFILE="$(mktemp -t xiezuomanju-agent-worker).sb"
trap 'rm -f "$PROFILE"' EXIT

sed "s#__REPO_ROOT__#$REPO_ROOT#g" "$TEMPLATE" > "$PROFILE"
echo "[agent-worker] 运行于 OS 沙箱：$PROFILE" >&2
exec sandbox-exec -f "$PROFILE" pnpm --filter @xiezuomanju/agent-worker start
