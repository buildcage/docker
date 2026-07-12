#!/bin/bash
# Verifies that the explicit engine's audit mode never denies anything (its
# generated source policy has an empty rule set — see
# docker/tools/explicit/lib/source-policy.js), that the report action reports
# mode=audit with a zero blockedCount, and that the hosts actually accessed
# during the build show up in report.js's sections.audited.
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
REPORT_JSON=$(docker compose exec builder qjs -m /opt/buildcage/tools/explicit/report.js 2>/dev/null)
MODE=$(echo "$REPORT_JSON" | sed -n 's/.*"mode": *"\([a-z]*\)".*/\1/p')
BLOCKED_COUNT=$(echo "$REPORT_JSON" | grep -o '"blockedCount": *[0-9]*' | grep -o '[0-9]*$' || echo "")
if [ "$MODE" = "audit" ] && [ "$BLOCKED_COUNT" = "0" ]; then
  echo "  PASS  report.js mode=audit blockedCount=0"
else
  echo "  FAIL  report.js mode='$MODE' blockedCount='$BLOCKED_COUNT', expected mode=audit blockedCount=0"
  FAILURES=$((FAILURES + 1))
fi

# report.js has no "audited" section at all (see report.js's header comment)
# — that table is built by report/src/main.js itself from buildctl's
# build-history vertex log (see report/src/lib/vertex-log.js's
# aggregateAllowedHosts). Verified further down via the rendered markdown.

# Audit mode's empty policy never denies, so deniedTimeline must be empty —
# see docker/tools/explicit/lib/buildkitd-log-parser.js's parseDenialTimeline.
DENIED_TIMELINE_COUNT=$(echo "$REPORT_JSON" | sed -n '/"deniedTimeline":/,/\]/p' | grep -c '"url":' || true)
if [ "$DENIED_TIMELINE_COUNT" -eq 0 ]; then
  echo "  PASS  report.js deniedTimeline is empty"
else
  echo "  FAIL  report.js deniedTimeline has $DENIED_TIMELINE_COUNT entries, expected 0"
  FAILURES=$((FAILURES + 1))
fi
echo ""

# GITHUB_STEP_SUMMARY is unset here on purpose: main.js writes the rendered
# markdown there instead of stdout whenever it's set, which it always is
# inside an actual GitHub Actions job (including this one) — so leaving it
# set would make $REPORT_MARKDOWN capture nothing.
REPORT_MARKDOWN=$(GITHUB_STEP_SUMMARY= PROXY_ENGINE=explicit node report/src/main.js ./compose.yaml 2>&1 || true)

# The "Audited Hosts" table is built by report/src/main.js itself (not
# report.js) from buildctl's build-history vertex log, aggregated by
# aggregateAllowedHosts — see report/src/lib/vertex-log.js.
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

# The per-command "Communication details" section is built by report/src/main.js
# itself (not report.js) via buildctl debug histories/logs — see
# report/src/lib/vertex-log.js. Step-counter brackets are escaped in the
# rendered markdown (see command-log.js's escapeMarkdown) — "**\[3/8\] RUN ...".
echo "[report action] per-command communication detail (rendered markdown):"
if grep -qF "Communication details" <<< "$REPORT_MARKDOWN" \
  && grep -qE '^\*\*\\\[ *[0-9]+/[0-9]+\\\] RUN ' <<< "$REPORT_MARKDOWN" \
  && grep -qE -- '- GET https://blocked\.example\.com/ -> 200' <<< "$REPORT_MARKDOWN" \
  && ! grep -qF "**DENIED**" <<< "$REPORT_MARKDOWN"; then
  echo "  PASS  rendered markdown has per-command breakdown with no DENIED section"
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
