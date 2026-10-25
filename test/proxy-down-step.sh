#!/bin/sh
# Runs as the RUN step of test/Dockerfile.inspect-proxy-down, while
# test/run-inspect-proxy-down.sh stops the builder's services between the
# phases below. The step cannot reach the runner, so the two take turns through
# marker files in the step's own /tmp, which the driver reaches from inside the
# builder through /proc/<pid>/root. Any failed check fails the build.
# shellcheck source-path=SCRIPTDIR
. "$(dirname "$0")/scenarios/lib.sh"

C='curl -sS -o /dev/null -w %{http_code} --max-time 10'

# Bounded, so a driver that never writes the marker ends the build instead of
# hanging it.
wait_for() {
  i=0
  while [ ! -e "$1" ]; do
    i=$((i + 1))
    [ "$i" -gt 240 ] && return 1
    sleep 0.5
  done
}

# 000 is curl's code for a request that got no HTTP answer at all.
assert_unreachable() {
  label="$1"
  shift
  # shellcheck disable=SC2086 # $C is a command line
  check_status "$label" "$($C "$@")" "000"
}

finish() {
  scenario_results "proxy-down step"
  exit
}

# A lookup over TCP at the fixture resolver, which allowed_ip_rules names: the
# first 4 bytes of the answer, in hex, end with the query's id.
QUERY='\000\035\253\315\001\000\000\001\000\000\000\000\000\000\007example\003com\000\000\001\000\001'

echo "=== [proxy up: the allowed origin is reachable] ==="
# shellcheck disable=SC2086
check_status "allowed.example.com HTTP" "$($C http://allowed.example.com/public/pkg.tgz)" "200"
# shellcheck disable=SC2086
check_status "allowed.example.com HTTPS" "$($C https://allowed.example.com/public/pkg.tgz)" "200"
check_status "a TCP lookup at 10.200.0.53 was answered" "$(reply_head 4 10.200.0.53 53 "$QUERY" | cut -c5-8)" "abcd"
touch /tmp/serving.done

echo "=== [haproxy stopped: nothing gets through] ==="
if ! wait_for /tmp/haproxy.down; then
  fail "the driver never stopped haproxy"
  finish
fi
# The resolver still answers, so the failures below are the listener's.
if timeout 20 nslookup allowed.example.com >/dev/null 2>&1; then
  pass "allowed.example.com still resolves with only haproxy stopped"
else
  fail "allowed.example.com stopped resolving with only haproxy stopped"
fi
assert_unreachable "allowed.example.com HTTP fails with haproxy stopped" \
  http://allowed.example.com/public/pkg.tgz
assert_unreachable "allowed.example.com HTTPS fails with haproxy stopped" \
  https://allowed.example.com/public/pkg.tgz
assert_unreachable "the origin's address fails with haproxy stopped" \
  http://10.200.0.100/pub-by-addr/pkg.tgz
touch /tmp/haproxy-phase.done

echo "=== [coredns stopped too: no lookups, still nothing gets through] ==="
if ! wait_for /tmp/coredns.down; then
  fail "the driver never stopped coredns"
  finish
fi
if timeout 20 nslookup allowed.example.com >/dev/null 2>&1; then
  fail "allowed.example.com still resolved with coredns stopped"
else
  pass "allowed.example.com no longer resolves with coredns stopped"
fi
# Nor can a lookup find another way out.
if timeout 10 nslookup allowed.example.com 10.200.0.53 >/dev/null 2>&1; then
  fail "a lookup at 10.200.0.53 over UDP was answered with both stopped"
else
  pass "a lookup at 10.200.0.53 over UDP fails with both stopped"
fi
check_status "a TCP lookup at 10.200.0.53 fails with both stopped" \
  "$(reply_head 4 10.200.0.53 53 "$QUERY")" ""

finish
