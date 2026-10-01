#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/helpers.sh"

LOGS=$(builder_log haproxy)

echo ""
echo "=== Zero-Traffic Restrict Mode Assertions ==="
echo ""

echo "[haproxy log] no traffic, but the guaranteed startup marker is present:"
if grep -qF "buildcage haproxy starting" <<< "$LOGS"; then
  pass "startup marker found"
else
  fail "startup marker not found in haproxy log"
fi
echo ""

assert_log_not_contains ALLOWED
assert_log_not_contains BLOCKED
echo ""

# report-action.js runs its own plausibility check against the haproxy log
# above; a regression here means it treats the traffic-free log as
# suspicious and fails the step despite blockedCount being 0 (see
# docker/common/files/s6-rc.d/haproxy/run). fail_on_blocked is forced
# to true (matching action.yml's default) since that's the setting under
# which the false positive actually fails the job.
REPORT_EXIT_CODE=0
REPORT_OUTPUT=$(GITHUB_STEP_SUMMARY= INPUT_FAIL_ON_BLOCKED=true node report/src/main.ts 2>&1) || REPORT_EXIT_CODE=$?

echo "[report action] exits successfully despite zero traffic:"
if [ "$REPORT_EXIT_CODE" -eq 0 ]; then
  pass "report exited 0"
else
  fail "report exited $REPORT_EXIT_CODE"
  echo "$REPORT_OUTPUT"
fi
echo ""

echo "[report action] no false-positive blocked-connection error:"
# Both annotations the head check can produce: the blocked-connection one and
# the incomplete-log one it is replaced by when the marker is missing. Matched
# on the part that outlives a rewording of what is counted: the check fires on
# absence, where a pattern that quietly stops matching would pass.
if grep -qE "detected by buildcage|logs are incomplete" <<< "$REPORT_OUTPUT"; then
  fail "unexpected blocked-connection or incomplete-log message in report output"
  echo "$REPORT_OUTPUT"
else
  pass "no blocked-connection or incomplete-log message"
fi
echo ""

assert_results
