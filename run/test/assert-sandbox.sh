#!/bin/bash
# Verifies the run action's report output. Reads
# BUILDCAGE_RUN_DEBUG_SUMMARY_FILE rather than GITHUB_STEP_SUMMARY:
# GitHub silently ignores attempts to reassign that reserved env var, and it
# is unique per step anyway, so a later step could never read an earlier
# step's copy back through it. The run action itself stops its own
# throwaway proxy container before this script runs, so unlike
# test/assert-{transparent,explicit}-*.sh, there's no long-lived builder
# container left to `docker compose exec` into either.
set -euo pipefail

echo ""
echo "=== Sandbox Report Assertions ==="
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

assert_summary_contains "example.com:80" "Allowed HTTP host recorded in report"
assert_summary_contains "example.com:443" "Allowed HTTPS host recorded in report"
assert_summary_contains "neverssl.com:80" "Blocked HTTP host recorded in report"
assert_summary_contains "example.org:443" "Blocked HTTPS host recorded in report"

echo ""
if [ "$FAILURES" -gt 0 ]; then
  echo "❌ FAILED: $FAILURES assertion(s) failed"
  exit 1
fi
echo "✅ All assertions passed."
echo ""
