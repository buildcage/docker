#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/helpers.sh"

echo ""
echo "=== Zero-Traffic Restrict Mode Assertions ==="
echo ""

echo "[haproxy log] no traffic, but the guaranteed startup marker is present:"
if grep -qF "buildcage haproxy starting" <<< "$LOGS"; then
  echo "  PASS  startup marker found"
else
  echo "  FAIL  startup marker not found in haproxy log"
  FAILURES=$((FAILURES + 1))
fi
echo ""

assert_log_not_contains ALLOWED
assert_log_not_contains BLOCKED
echo ""

# report-action.js runs its own plausibility check against the haproxy log
# above; a regression here means it treats the traffic-free log as
# suspicious and fails the step despite blockedCount being 0 (see
# docker/universal/files/s6-rc.d/haproxy/run). fail_on_blocked is forced
# to true (matching action.yml's default) since that's the setting under
# which the false positive actually fails the job. GITHUB_STEP_SUMMARY is
# unset so it prints to stdout instead of a job-summary file.
REPORT_EXIT_CODE=0
REPORT_OUTPUT=$(GITHUB_STEP_SUMMARY= INPUT_FAIL_ON_BLOCKED=true node report/src/main.ts 2>&1) || REPORT_EXIT_CODE=$?

echo "[report action] exits successfully despite zero traffic:"
if [ "$REPORT_EXIT_CODE" -eq 0 ]; then
  echo "  PASS  report exited 0"
else
  echo "  FAIL  report exited $REPORT_EXIT_CODE"
  echo "$REPORT_OUTPUT"
  FAILURES=$((FAILURES + 1))
fi
echo ""

echo "[report action] no false-positive blocked-connection error:"
if grep -qF "blocked connection(s) detected" <<< "$REPORT_OUTPUT"; then
  echo "  FAIL  unexpected blocked-connection message in report output"
  echo "$REPORT_OUTPUT"
  FAILURES=$((FAILURES + 1))
else
  echo "  PASS  no blocked-connection message"
fi
echo ""

assert_results
echo ""
