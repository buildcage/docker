#!/bin/bash
# Verifies audit mode: buildkitd never denies anything, report.js reports
# mode=audit with no blocked/message fields, and accessed hosts show up in
# the rendered Audited Hosts table.
set -euo pipefail

FAILURES=0
LOGS=$(docker compose exec builder cat /var/log/buildkitd/current 2>/dev/null)

echo ""
echo "=== Explicit Proxy Engine Audit Mode Assertions ==="
echo ""

echo "[no denials] audit mode's empty source policy must never deny anything:"
DENIAL_COUNT=$(echo "$LOGS" | grep -cF "denied by policy" || true)
if [ "$DENIAL_COUNT" -eq 0 ]; then
  echo "  PASS  no denial entries found in buildkitd's debug log"
else
  echo "  FAIL  found $DENIAL_COUNT unexpected denial entries"
  FAILURES=$((FAILURES + 1))
fi
echo ""

echo "[report action] JSON round-trip through the explicit-mode report.js:"
REPORT_JSON=$(docker compose exec builder qjs --std -m /opt/buildcage/scripts/report.js 2>/dev/null)
MODE=$(echo "$REPORT_JSON" | sed -n 's/.*"mode": *"\([a-z]*\)".*/\1/p')
# Audit mode never sets "blocked"/"message" (only restrict mode does — see
# core/scripts/report.ts), and this engine's audit-mode source policy never
# blocks anything (core/lib/acl/source-policy.ts).
if [ "$MODE" = "audit" ] && ! grep -q '"blocked"' <<< "$REPORT_JSON" && ! grep -q '"message"' <<< "$REPORT_JSON"; then
  echo "  PASS  report.js mode=audit, no blocked/message fields"
else
  echo "  FAIL  report.js mode='$MODE', expected mode=audit with no blocked/message fields: $REPORT_JSON"
  FAILURES=$((FAILURES + 1))
fi
echo ""

# report.js renders the full stepSummary itself; report/src/main.ts just
# relays it. GITHUB_STEP_SUMMARY is unset so it prints to stdout instead of
# a job-summary file.
REPORT_MARKDOWN=$(GITHUB_STEP_SUMMARY= node report/src/main.ts 2>&1 || true)

echo "[report action] Audited Hosts table (rendered markdown, from buildctl aggregation):"
if grep -qF "### 📋 Audited Hosts" <<< "$REPORT_MARKDOWN" \
  && grep -qF "| blocked.example.com:443 | HTTPS | 1 |" <<< "$REPORT_MARKDOWN" \
  && grep -qF "| 10.200.0.100:80 | HTTP | 1 |" <<< "$REPORT_MARKDOWN"; then
  echo "  PASS  rendered markdown has an Audited Hosts table incl. blocked.example.com and 10.200.0.100"
else
  echo "  FAIL  rendered markdown missing expected Audited Hosts table content"
  FAILURES=$((FAILURES + 1))
fi
echo ""

# Step-counter brackets are escaped in the rendered markdown (see
# command-log.ts's escapeMarkdown) — "* \[3/8\] RUN ...".
echo "[report action] per-command communication detail (rendered markdown):"
if grep -qF "Communication details" <<< "$REPORT_MARKDOWN" \
  && grep -qF "Allowed Urls" <<< "$REPORT_MARKDOWN" \
  && grep -qE '^ *\* \\\[ *[0-9]+/[0-9]+\\\] RUN ' <<< "$REPORT_MARKDOWN" \
  && grep -qE -- '- GET https://blocked\.example\.com/ -> 200' <<< "$REPORT_MARKDOWN" \
  && ! grep -qF "Blocked Urls" <<< "$REPORT_MARKDOWN"; then
  echo "  PASS  rendered markdown has per-command breakdown with no Blocked Urls section"
else
  echo "  FAIL  rendered markdown missing expected Communication details content"
  FAILURES=$((FAILURES + 1))
fi
echo ""

if [ "$FAILURES" -gt 0 ]; then
  echo "❌ FAILED: $FAILURES assertion(s) failed"
  exit 1
fi
echo "✅ All assertions passed."
echo ""
