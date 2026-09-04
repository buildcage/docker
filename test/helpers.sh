#!/bin/bash
set -euo pipefail

FAILURES=0
LOGS=$(docker compose exec builder cat /var/log/haproxy/current 2>/dev/null)

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
  local buildcage_logs
  buildcage_logs=$(grep buildcage <<< "$LOGS" || true)
  if grep -q "$pattern" <<< "$buildcage_logs"; then
    echo "  PASS  $label"
  else
    echo "  FAIL  $label  -- not found in logs"
    FAILURES=$((FAILURES + 1))
  fi
}

assert_log_not_matching() {
  local marker="$1"
  local host_port="$2"
  local reason="${3:-}"
  local pattern="\[$marker\].*\"$host_port\""
  local label="[$marker] $host_port"
  if [ -n "$reason" ]; then
    pattern="$pattern $reason"
    label="$label $reason"
  fi
  local buildcage_logs
  buildcage_logs=$(grep buildcage <<< "$LOGS" || true)
  if grep -q "$pattern" <<< "$buildcage_logs"; then
    echo "  FAIL  found unexpected $label line"
    FAILURES=$((FAILURES + 1))
  else
    echo "  PASS  no $label line"
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

assert_no_forged_log_lines() {
  local decision_logs
  # Restrict to actual decision lines ("buildcage [...]") -- the plausibility
  # startup line ("buildcage haproxy starting", see s6-rc.d/haproxy/run) has
  # no bracket after "buildcage " and would otherwise false-positive below.
  decision_logs=$(grep 'buildcage \[' <<< "$LOGS" || true)
  local bad_lines
  # A well-formed buildcage line has exactly two double quotes (the
  # host:port field) and no embedded control characters. A forged line
  # (unsanitized attacker bytes) breaks one of those two invariants.
  bad_lines=$(awk '{ n = gsub(/"/, "\""); if (n != 2) print; else if (/[[:cntrl:]]/) print }' <<< "$decision_logs")
  if [ -z "$bad_lines" ]; then
    echo "  PASS  no forged/malformed buildcage log lines"
  else
    echo "  FAIL  found malformed buildcage log line(s):"
    echo "$bad_lines" | sed 's/^/    /'
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
