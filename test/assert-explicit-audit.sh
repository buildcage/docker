#!/bin/bash
# Verifies that the explicit engine's audit mode never denies anything (its
# generated source policy has an empty rule set — see
# docker/tools/explicit/lib/source-policy.js) and that the report action
# reports mode=audit with a zero blockedCount.
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
echo ""

if [ "$FAILURES" -gt 0 ]; then
  echo "❌ FAILED: $FAILURES assertion(s) failed"
  exit 1
fi
echo "✅ All assertions passed."
echo ""
