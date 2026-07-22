#!/bin/bash
# Verifies audit mode's report: audited-hosts table plus the
# auto-generated restrict-mode example.
set -euo pipefail

echo ""
echo "=== Sandbox Audit-Mode Report Assertions ==="
echo ""

FAILURES=0
SUMMARY=$(cat "$BUILDCAGE_RUN_DEBUG_SUMMARY_FILE")

assert_summary_contains() {
  local pattern="$1"
  local label="$2"
  if grep -qF -- "$pattern" <<< "$SUMMARY"; then
    echo "  PASS  $label"
  else
    echo "  FAIL  $label -- not found in sandbox report"
    FAILURES=$((FAILURES + 1))
  fi
}

assert_summary_contains "example.com:80" "Audited HTTP host recorded in report"
assert_summary_contains "example.com:443" "Audited HTTPS host recorded in report"
assert_summary_contains "Switch to restrict mode" "Restrict-mode example section present"
assert_summary_contains "uses: dash14/buildcage/run@v2" "Restrict-mode example uses the run action"
assert_summary_contains "run: |" "Restrict-mode example preserves the run: command"
assert_summary_contains "proxy_mode: restrict" "Restrict-mode example sets proxy_mode: restrict"
assert_summary_contains "allowed_https_rules: >-" "Restrict-mode example includes allowed_https_rules"
assert_summary_contains "allowed_http_rules: >-" "Restrict-mode example includes allowed_http_rules"

echo ""
if [ "$FAILURES" -gt 0 ]; then
  echo "❌ FAILED: $FAILURES assertion(s) failed"
  exit 1
fi
echo "✅ All assertions passed."
echo ""
