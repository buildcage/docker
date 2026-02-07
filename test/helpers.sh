#!/bin/bash
set -euo pipefail

FAILURES=0
LOGS=$(docker compose logs --no-log-prefix builder 2>/dev/null)

assert_log_contains() {
  local marker="$1"
  local host_port="$2"
  if echo "$LOGS" | grep -q "\[$marker\].*\"$host_port\""; then
    echo "  PASS  [$marker] $host_port"
  else
    echo "  FAIL  [$marker] $host_port  -- not found in logs"
    FAILURES=$((FAILURES + 1))
  fi
}

assert_log_not_contains() {
  local marker="$1"
  local count
  count=$(echo "$LOGS" | grep -c "\[$marker\]" || true)
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
