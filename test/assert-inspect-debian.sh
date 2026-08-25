#!/bin/bash
set -euo pipefail

# Shared between audit and restrict: Dockerfile.inspect-debian's own RUN
# steps already fail the build if apt did not trust the injected CA (see the
# Dockerfile), so this only confirms both requests actually reached HAProxy
# and were logged, in either mode.

FAILURES=0
PROXY_LOG=$(docker compose exec builder cat /var/log/haproxy/current 2>/dev/null)

pass() { echo "  PASS  $1"; }
fail() {
  echo "  FAIL  $1"
  FAILURES=$((FAILURES + 1))
}

echo ""
echo "=== Inspect Proxy Engine Assertions (Debian/apt) ==="
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

if [ "$FAILURES" -gt 0 ]; then
  echo "❌ FAILED: $FAILURES assertion(s) failed"
  exit 1
fi
echo "✅ All assertions passed."
echo ""
