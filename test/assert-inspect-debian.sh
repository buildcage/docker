#!/bin/bash
set -euo pipefail

# Usage: assert-inspect-debian.sh <audit|restrict>
#
# Dockerfile.inspect-debian's own RUN steps already fail the build if apt did
# not trust the injected CA, so the shared assertions below only confirm both
# bootstrap requests reached HAProxy and were logged. The last request is the
# one the two modes disagree about: it asks for a path no rule covers, which
# restrict refuses with a 403 and audit lets through to the origin.

MODE="${1:-}"
case "$MODE" in
  audit | restrict) ;;
  *)
    echo "usage: $0 <audit|restrict>" >&2
    exit 2
    ;;
esac

FAILURES=0
PROXY_LOG=$(docker compose exec builder cat /var/log/haproxy/current 2>/dev/null)

pass() { echo "  PASS  $1"; }
fail() {
  echo "  FAIL  $1"
  FAILURES=$((FAILURES + 1))
}

echo ""
echo "=== Inspect Proxy Engine Assertions (Debian/apt, $MODE) ==="
echo ""

echo "[apt bootstrap] ca-certificates fetched over plain HTTP:"
if grep -qE "^buildcage [0-9]+ http GET http://deb\.debian\.org/" <<< "$PROXY_LOG"; then
  pass "reached deb.debian.org"
else
  fail "no request to deb.debian.org was recorded"
fi
echo ""

echo "[apt over HTTPS] the fixture reached on the CA the wrapper injected:"
if grep -qE "^buildcage [0-9]+ https GET https://allowed\.example\.com/public/debian" <<< "$PROXY_LOG"; then
  pass "reached the fixture over TLS"
else
  fail "no HTTPS request to the fixture was recorded"
fi
echo ""

# /private/** is outside allowed_url_rules (see compose.test-inspect.yaml),
# and the fixture answers any path with 200, so the status recorded here is
# the proxy's decision and nothing else.
OUTSIDE="^buildcage [0-9]+ https GET https://allowed\.example\.com/private/debian[^ ]*"
echo "[apt outside the rules] the request $MODE should have produced:"
if [ "$MODE" = "restrict" ]; then
  if grep -qE "$OUTSIDE 403 " <<< "$PROXY_LOG"; then
    pass "refused with 403, so apt never reached the origin"
  else
    fail "the out-of-rules request was not refused"
    grep -E "$OUTSIDE" <<< "$PROXY_LOG" || echo "    (no matching log line at all)"
  fi
else
  if grep -qE "$OUTSIDE 200 " <<< "$PROXY_LOG"; then
    pass "recorded and allowed through to the origin, as audit refuses nothing"
  else
    fail "the out-of-rules request did not reach the origin"
    grep -E "$OUTSIDE" <<< "$PROXY_LOG" || echo "    (no matching log line at all)"
  fi
  if grep -qE "^buildcage [0-9]+ https? [A-Z]+ [^ ]+ 403 " <<< "$PROXY_LOG"; then
    fail "something was refused with 403, which audit must never do"
  else
    pass "nothing was refused anywhere in this build"
  fi
fi
echo ""

if [ "$FAILURES" -gt 0 ]; then
  echo "❌ FAILED: $FAILURES assertion(s) failed"
  exit 1
fi
echo "✅ All assertions passed."
echo ""
