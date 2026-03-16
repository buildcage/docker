#!/bin/bash
set -euo pipefail

FAILURES=0
BUILDCAGE_CONTAINER=$(docker ps -q -f name=buildx_buildkit_buildcage 2>/dev/null)
if [ -z "$BUILDCAGE_CONTAINER" ]; then
  echo "ERROR: buildcage container not found" >&2
  exit 1
fi
LOGS=$(docker exec "$BUILDCAGE_CONTAINER" cat /var/log/haproxy/current 2>/dev/null)

assert_log_contains() {
  local marker="$1"
  local host_port="$2"
  local reason="${3:-}"
  local pattern="\[$marker\].*\"$host_port\""
  local label="[$marker] $host_port"
  if [ -n "$reason" ]; then
    pattern="$pattern $reason"
    label="$label $reason"
  fi
  if echo "$LOGS" | grep buildcage | grep -q "$pattern"; then
    echo "  PASS  $label"
  else
    echo "  FAIL  $label  -- not found in logs"
    FAILURES=$((FAILURES + 1))
  fi
}

assert_log_not_contains() {
  local marker="$1"
  local count
  count=$(echo "$LOGS" | grep buildcage | grep -c "\[$marker\]" || true)
  if [ "$count" -eq 0 ]; then
    echo "  PASS  no [$marker] entries"
  else
    echo "  FAIL  found $count unexpected [$marker] entries"
    FAILURES=$((FAILURES + 1))
  fi
}

assert_results() {
  echo ""
  if [ "$FAILURES" -gt 0 ]; then
    echo "❌ FAILED: $FAILURES assertion(s) failed"
    exit 1
  fi
  echo "✅ All assertions passed."
}
