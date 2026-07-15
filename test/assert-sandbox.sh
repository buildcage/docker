#!/bin/bash
# Verifies the sandbox action's Job Summary output (GITHUB_STEP_SUMMARY),
# since the action stops its own throwaway proxy container before this
# script runs -- unlike test/assert-{transparent,explicit}-*.sh, there's no
# long-lived builder container left to `docker compose exec` into.
set -euo pipefail

echo ""
echo "=== Sandbox Job Summary Assertions ==="
echo ""

FAILURES=0
SUMMARY=$(cat "$GITHUB_STEP_SUMMARY")

assert_summary_contains() {
  local pattern="$1"
  local label="$2"
  if grep -qF -- "$pattern" <<< "$SUMMARY"; then
    echo "  PASS  $label"
  else
    echo "  FAIL  $label -- not found in Job Summary"
    FAILURES=$((FAILURES + 1))
  fi
}

assert_summary_contains "example.com:443" "Allowed host recorded in report"
assert_summary_contains "neverssl.com:80" "Blocked host recorded in report"

echo ""
if [ "$FAILURES" -gt 0 ]; then
  echo "❌ FAILED: $FAILURES assertion(s) failed"
  exit 1
fi
echo "✅ All assertions passed."
echo ""
