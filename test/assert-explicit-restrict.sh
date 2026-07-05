#!/bin/bash
set -euo pipefail

FAILURES=0
LOGS=$(docker compose exec builder cat /var/log/buildkitd/current 2>/dev/null)

# BuildKit's exec-proxy identifier omits an explicit ":443"/":80" when the
# original request didn't specify a port (verified against a live
# moby/buildkit v0.31.1 container — see docs/security.md), so callers must
# pass the exact target URL they expect in the log, port included only when
# it's non-default.
assert_denied() {
  local target="$1"
  if echo "$LOGS" | grep -qF "ref=\"${target}\""; then
    echo "  PASS  [BLOCKED] $target"
  else
    echo "  FAIL  [BLOCKED] $target -- not found in logs"
    FAILURES=$((FAILURES + 1))
  fi
}

# Anchors the needle to right after "://" so e.g. "sub.wildcard.example.com"
# does not spuriously match a denial for "deep.sub.wildcard.example.com".
assert_no_denials_for() {
  local needle="$1"
  local escaped count
  escaped=$(printf '%s' "$needle" | sed 's/[.]/\\./g')
  count=$(echo "$LOGS" | grep -F "denied by policy" | grep -cE "://${escaped}[:/]" || true)
  if [ "$count" -eq 0 ]; then
    echo "  PASS  no denial entries for \"$needle\""
  else
    echo "  FAIL  found $count unexpected denial entries for \"$needle\""
    FAILURES=$((FAILURES + 1))
  fi
}

echo ""
echo "=== Explicit Proxy Engine Assertions ==="
echo ""

echo "[BLOCKED] expected (source-policy denials in buildkitd's own debug log):"
assert_denied "https://blocked.example.com/"
assert_denied "http://blocked.example.com/"
assert_denied "https://blocked.example.com:8443/"
assert_denied "http://blocked.example.com:8080/"
assert_denied "https://deep.sub.wildcard.example.com/"
assert_denied "http://10.200.0.100/"
echo ""

echo "[ALLOWED] must not be denied:"
assert_no_denials_for "allowed.example.com"
assert_no_denials_for "sub.wildcard.example.com"
echo ""

echo "[FROM pull] must not be denied (docker-image:// is out of the ^https?:// policy scope):"
FROM_DENIALS=$(echo "$LOGS" | grep -F "denied by policy" | grep -cF "docker-image://" || true)
if [ "$FROM_DENIALS" -eq 0 ]; then
  echo "  PASS  no denial entries for docker-image:// sources"
else
  echo "  FAIL  found $FROM_DENIALS unexpected denial entries for docker-image:// sources"
  FAILURES=$((FAILURES + 1))
fi
echo ""

echo "[report action] JSON round-trip through the explicit-mode report.js:"
REPORT_JSON=$(docker compose exec builder qjs -m /opt/buildcage/tools/explicit/report.js 2>/dev/null)
BLOCKED_COUNT=$(echo "$REPORT_JSON" | grep -o '"blockedCount": *[0-9]*' | grep -o '[0-9]*$' || echo "")
if [ -n "$BLOCKED_COUNT" ] && [ "$BLOCKED_COUNT" -ge 6 ]; then
  echo "  PASS  report.js blockedCount=$BLOCKED_COUNT (>= 6 expected)"
else
  echo "  FAIL  report.js blockedCount='$BLOCKED_COUNT', expected >= 6"
  FAILURES=$((FAILURES + 1))
fi
echo ""

if [ "$FAILURES" -gt 0 ]; then
  echo "❌ FAILED: $FAILURES assertion(s) failed"
  exit 1
fi
echo "✅ All assertions passed."
echo ""
