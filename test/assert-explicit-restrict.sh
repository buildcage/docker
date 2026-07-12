#!/bin/bash
set -euo pipefail

FAILURES=0
LOGS=$(docker compose exec builder cat /var/log/buildkitd/current 2>/dev/null)

# BuildKit's exec-proxy identifier omits an explicit ":443"/":80" when the
# original request didn't specify a port (see docs/security.md), so callers
# must pass the exact target URL they expect in the log, port included only
# when it's non-default.
assert_denied() {
  local target="$1"
  if grep -qF "ref=\"${target}\"" <<< "$LOGS"; then
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

# report.js has no "allowed" section at all (see report.js's header comment)
# — that table is built by report/src/main.js itself from buildctl's
# build-history vertex log (see report/src/lib/vertex-log.js's
# aggregateAllowedHosts). Verified further down via the rendered markdown.

# Parsed from BuildKit's own source-policy denials, with a timestamp each —
# see docker/tools/explicit/lib/buildkitd-log-parser.js's parseDenialTimeline.
DENIED_TIMELINE_COUNT=$(echo "$REPORT_JSON" | sed -n '/"deniedTimeline":/,/\]/p' | grep -c '"url":' || true)
if [ "$DENIED_TIMELINE_COUNT" -ge 6 ]; then
  echo "  PASS  report.js deniedTimeline has $DENIED_TIMELINE_COUNT entries (>= 6 expected)"
else
  echo "  FAIL  report.js deniedTimeline has $DENIED_TIMELINE_COUNT entries, expected >= 6"
  FAILURES=$((FAILURES + 1))
fi
echo ""

# The per-command "Communication details" section is built by report/src/main.js
# itself (not report.js) via buildctl debug histories/logs — see
# report/src/lib/vertex-log.js. Verify the rendered markdown directly.
#
# GITHUB_STEP_SUMMARY is unset here on purpose: main.js writes the rendered
# markdown there instead of stdout whenever it's set, which it always is
# inside an actual GitHub Actions job (including this one) — so leaving it
# set would make $REPORT_MARKDOWN capture nothing.
REPORT_MARKDOWN=$(GITHUB_STEP_SUMMARY= PROXY_ENGINE=explicit node report/src/main.js ./compose.yaml 2>&1 || true)

# The "Allowed Hosts" table is built by report/src/main.js itself (not
# report.js) from buildctl's build-history vertex log, aggregated by
# aggregateAllowedHosts — see report/src/lib/vertex-log.js.
echo "[report action] Allowed Hosts table (rendered markdown, from buildctl aggregation):"
if grep -qF "### ✅ Allowed Hosts" <<< "$REPORT_MARKDOWN" \
  && grep -qF "| allowed.example.com:443 | HTTPS | 1 |" <<< "$REPORT_MARKDOWN" \
  && grep -qF "| sub.wildcard.example.com:443 | HTTPS | 1 |" <<< "$REPORT_MARKDOWN"; then
  echo "  PASS  rendered markdown has an Allowed Hosts table incl. allowed.example.com and sub.wildcard.example.com"
else
  echo "  FAIL  rendered markdown missing expected Allowed Hosts table content"
  FAILURES=$((FAILURES + 1))
fi
echo ""

# The per-command "Communication details" section is built by report/src/main.js
# itself (not report.js) via buildctl debug histories/logs — see
# report/src/lib/vertex-log.js. Step-counter brackets are escaped in the
# rendered markdown (see command-log.js's escapeMarkdown) — "**\[ 3/15\] RUN ...".
echo "[report action] per-command communication detail (rendered markdown):"
if grep -qF "Communication details" <<< "$REPORT_MARKDOWN" \
  && grep -qE '^\*\*\\\[ *[0-9]+/[0-9]+\\\] RUN ' <<< "$REPORT_MARKDOWN" \
  && grep -qF "(no communication)" <<< "$REPORT_MARKDOWN" \
  && grep -qE -- '- GET https://allowed\.example\.com/ -> 200' <<< "$REPORT_MARKDOWN" \
  && grep -qF "**DENIED**" <<< "$REPORT_MARKDOWN" \
  && grep -qF "https://blocked.example.com/" <<< "$REPORT_MARKDOWN"; then
  echo "  PASS  rendered markdown has per-command breakdown, (no communication), and a DENIED list"
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
