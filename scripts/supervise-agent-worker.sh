#!/usr/bin/env bash
# 常驻拉起 Node agent-worker：崩溃自动重启并记 exit code（排查静默退出）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/services/agent-worker"
# shellcheck disable=SC1091
set -a
# Prefer monorepo .env
[[ -f "$ROOT/.env" ]] && source "$ROOT/.env"
set +a
export API_BASE="${API_BASE:-http://127.0.0.1:8000}"
export JOB_AGENT_QUEUE_KEY="${JOB_AGENT_QUEUE_KEY:-jobs:agent}"
export AGENT_REQUIRE_LEASE="${AGENT_REQUIRE_LEASE:-true}"
export AGENT_LEASE_TTL_S="${AGENT_LEASE_TTL_S:-180}"
LOG="${XZMJ_AGENT_LOG:-/tmp/xzmj-logs/aw-screen-live.log}"
mkdir -p "$(dirname "$LOG")"
echo "[supervise-agent-worker] log=$LOG lease_ttl=${AGENT_LEASE_TTL_S}s require_lease=${AGENT_REQUIRE_LEASE}" | tee -a "$LOG"
while true; do
  echo "[supervisor] start $(date -u +%Y-%m-%dT%H:%M:%SZ) pid=$$" | tee -a "$LOG"
  set +e
  node --experimental-strip-types src/index.js >>"$LOG" 2>&1
  code=$?
  set -e
  echo "[supervisor] exit=${code} at $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$LOG"
  sleep 2
done
