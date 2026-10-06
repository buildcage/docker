#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/helpers.sh"

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

LOGS=$(builder_log haproxy)
ORIGIN_LOG=$(origin_log)

echo ""
echo "=== Inspect Proxy Engine Assertions (Debian/apt, $MODE) ==="
echo ""

echo "[apt bootstrap] ca-certificates fetched over plain HTTP:"
if grep -qE "^buildcage [0-9]+ http GET [0-9-]+ [0-9]+ ts=\S* reason=\S+ tlserr=\S+ dst=\S+ host=deb\.debian\.org /" <<< "$LOGS"; then
  pass "reached deb.debian.org"
else
  fail "no request to deb.debian.org was recorded"
fi
echo ""

echo "[apt over HTTPS] the fixture reached on the CA the wrapper injected:"
if grep -qE "^buildcage [0-9]+ https GET [0-9-]+ [0-9]+ ts=\S* reason=\S+ tlserr=\S+ dst=\S+ fcerr=\S+ sni=\S+ host=allowed\.example\.com /public/debian" <<< "$LOGS"; then
  pass "reached the fixture over TLS"
else
  fail "no HTTPS request to the fixture was recorded"
fi
# apt speaks only HTTP/1.1.
assert_origin_protocol HTTP/1.1 allowed.example.com '/public/debian/\S*'
echo ""

# /private/** is outside allowed_url_rules (see compose.test-inspect.yaml),
# and the fixture answers any path with 200, so the status recorded here is
# the proxy's decision and nothing else.
OUTSIDE_REQUEST="host=allowed\.example\.com /private/debian"
# The status sits ahead of the host and the target on the line, so the two
# halves are matched as one pattern rather than as a prefix.
outside() { printf '%s' "^buildcage [0-9]+ https GET $1 [0-9]+ ts=\S* reason=\S+ tlserr=\S+ dst=\S+ fcerr=\S+ sni=\S+ $OUTSIDE_REQUEST"; }
echo "[apt outside the rules] the request $MODE should have produced:"
if [ "$MODE" = "restrict" ]; then
  if grep -qE "$(outside 403)" <<< "$LOGS"; then
    pass "refused with 403, so apt never reached the origin"
  else
    fail "the out-of-rules request was not refused"
    grep -E "$OUTSIDE_REQUEST" <<< "$LOGS" || echo "    (no matching log line at all)"
  fi
else
  if grep -qE "$(outside 200)" <<< "$LOGS"; then
    pass "recorded and allowed through to the origin, as audit refuses nothing"
  else
    fail "the out-of-rules request did not reach the origin"
    grep -E "$OUTSIDE_REQUEST" <<< "$LOGS" || echo "    (no matching log line at all)"
  fi
  if grep -qE "^buildcage [0-9]+ https? [A-Z]+ 403 " <<< "$LOGS"; then
    fail "something was refused with 403, which audit must never do"
  else
    pass "nothing was refused anywhere in this build"
  fi
fi

assert_results
