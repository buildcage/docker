#!/bin/sh
# proxy-engine: universal in restrict mode, run inside the cage against the
# fixture origin and the rules the test runs the proxy with. What the proxy
# logged and reported for this traffic is asserted afterwards, outside the
# cage, so the cases that only send bytes still matter.
set -u
# shellcheck source-path=SCRIPTDIR
. "$(dirname "$0")/lib.sh"

# universal never terminates TLS, so the client sees the fixture origin's own
# self-signed certificate: -k is what lets a request that passed complete.
C="curl -sS -k -o /dev/null -w %{http_code} --max-time 10"

# $C through attempt, for check_blocked.
# shellcheck disable=SC2086 # $C is a command line, split on purpose
attempt_c() { attempt $C "$@"; }

# A blocked attempt ends in a reset or a timeout as often as a status, so
# these wait less.
blocked_code() { attempt_c --max-time 5 "$1"; }

echo "=== [HTTPS - allowed - exact match] ==="
check_status "allowed.example.com" "$($C https://allowed.example.com/)" "200"

# DNS names are case-insensitive, and a trailing dot is the same name. curl
# lowercases the host and drops its trailing dot before the TLS handshake, so
# only a Host header carries both forms through untouched. Each host is
# requested nowhere else, so its log line is this request's.
echo "=== [HTTP - allowed - uppercase host] ==="
check_status "ALLOWED.example.com HTTP" "$($C http://ALLOWED.example.com/)" "200"

echo "=== [HTTP - allowed - trailing dot] ==="
check_status "trailingdot.wildcard.example.com. HTTP" "$($C http://trailingdot.wildcard.example.com./)" "200"

echo "=== [HTTPS - allowed - wildcard] ==="
check_status "sub.wildcard.example.com" "$($C https://sub.wildcard.example.com/)" "200"

# The rule is written without anchors, so the near miss below being blocked
# proves they are supplied.
echo "=== [HTTPS - regex allowed] ==="
check_status "ok.regex.example.com" "$($C https://ok.regex.example.com/)" "200"

echo "=== [HTTPS - regex blocked, substring] ==="
check_blocked "not-ok.regex.example.com" "$(blocked_code https://not-ok.regex.example.com/)"

echo "=== [HTTPS - regex port alternation] ==="
check_status "ports.regex.example.com:443" "$($C https://ports.regex.example.com/)" "200"
check_status "ports.regex.example.com:8443" "$($C https://ports.regex.example.com:8443/)" "200"

echo "=== [HTTP - regex blocked, port not named] ==="
check_blocked "ports.regex.example.com:80" "$(blocked_code http://ports.regex.example.com/)"

echo "=== [HTTPS - blocked - nested subdomain] ==="
check_blocked "deep.sub.wildcard.example.com" "$(blocked_code https://deep.sub.wildcard.example.com/)"

echo "=== [HTTPS - blocked] ==="
check_blocked "blocked.example.com" "$(blocked_code https://blocked.example.com/)"

echo "=== [HTTP - allowed] ==="
check_status "allowed.example.com HTTP" "$($C http://allowed.example.com/)" "200"

echo "=== [HTTP - blocked] ==="
check_blocked "blocked.example.com HTTP" "$(blocked_code http://blocked.example.com/)"

echo "=== [HTTP - allowed - wildcard] ==="
check_status "sub.wildcard.example.com HTTP" "$($C http://sub.wildcard.example.com/)" "200"

echo "=== [Port 8443 - allowed] ==="
check_status "allowed.example.com:8443" "$($C https://allowed.example.com:8443/)" "200"

echo "=== [Port 8080 - allowed] ==="
check_status "allowed.example.com:8080" "$($C http://allowed.example.com:8080/)" "200"

echo "=== [Port 8443 - blocked] ==="
check_blocked "blocked.example.com:8443" "$(blocked_code https://blocked.example.com:8443/)"

echo "=== [Port 8080 - blocked] ==="
check_blocked "blocked.example.com:8080" "$(blocked_code http://blocked.example.com:8080/)"

echo "=== [Direct IP - blocked] ==="
check_blocked "10.200.0.100:80" "$(blocked_code http://10.200.0.100/)"

# allowed-ip-rules names only 8443 and 2525 of 10.200.0.100. The SNI is the
# client's to choose, so a name no rule allows must not block the allowed
# address.
echo "=== [Direct IP - allowed, SNI names a host no rule allows] ==="
check_status "10.200.0.100:8443 with SNI blocked.example.com" \
  "$($C --resolve blocked.example.com:8443:10.200.0.100 https://blocked.example.com:8443/)" "200"

# The client sends nothing and waits for the server to speak. The greeting
# arrives within 3s only if the passthrough does not wait out inspect-delay
# (5s) for the client's first bytes.
echo "=== [Direct IP - allowed, server speaks first] ==="
OUT=$(greeting 10.200.0.100 2525 3)
case "$OUT" in
  220\ *) pass "10.200.0.100:2525 greeted without waiting for the client" ;;
  *) fail "10.200.0.100:2525 sent no greeting within 3s -- got: $OUT" ;;
esac

# The cases below each wait out the resolver, seconds apiece, so they run
# alongside the rest and are checked at the end.
SLOW=$(mktemp -d)

echo "=== [HTTPS - dns-failed] (checked at the end) ==="
attempt_c https://nxdomain.wildcard.example.com/ > "$SLOW/nxdomain-https" &

echo "=== [HTTPS - dns-failed, AAAA only] (checked at the end) ==="
attempt_c https://v6only.wildcard.example.com/ > "$SLOW/v6only-https" &

# The HTTP path resolves through a do-resolve pair of its own, so the HTTPS
# cases above say nothing about it. These wait for the 503: a failed lookup
# takes about 4s and this path makes two, so a shorter wait ends before the
# proxy logs its line.
echo "=== [HTTP - dns-failed] (checked at the end) ==="
$C --max-time 20 http://nxdomain.wildcard.example.com/ > "$SLOW/nxdomain-http" &

echo "=== [HTTP - dns-failed, AAAA only] (checked at the end) ==="
$C --max-time 20 http://v6only.wildcard.example.com/ > "$SLOW/v6only-http" &

# internal.wildcard.example.com matches the wildcard rule but resolves to
# 169.254.169.254: the name passes the rules, the resolved address must not.
echo "=== [HTTPS - SSRF via allowlisted name] ==="
check_blocked "internal.wildcard.example.com" "$(blocked_code https://internal.wildcard.example.com/)"

echo "=== [HTTP - SSRF via allowlisted name] ==="
check_blocked "internal.wildcard.example.com HTTP" "$(blocked_code http://internal.wildcard.example.com/)"

# RFC1918 is exempt on purpose, so only the runner's address list blocks it.
echo "=== [HTTPS - SSRF back to the runner] ==="
check_blocked "runner.wildcard.example.com" "$(blocked_code https://runner.wildcard.example.com/)"

echo "=== [HTTP - SSRF back to the runner] ==="
check_blocked "runner.wildcard.example.com HTTP" "$(blocked_code http://runner.wildcard.example.com/)"

# A second request on a reused HTTP/1.1 connection is judged on its own, not
# by the first one's decision.
echo "=== [HTTP keep-alive - allowed then blocked] ==="
( (printf 'GET / HTTP/1.1\r\nHost: allowed.example.com\r\n\r\n'; sleep 1
  printf 'GET / HTTP/1.1\r\nHost: blocked.example.com\r\nConnection: close\r\n\r\n'; sleep 1) \
  | nc -w 5 allowed.example.com 80 > /dev/null 2>&1 || true) &
echo "  requests sent (the second must be logged as blocked)"

# The other direction: a block must not carry over either, reason included.
# keepalive.wildcard.example.com is requested here and nowhere else, so an
# allowed line for it is this connection's second request and nothing else.
echo "=== [HTTP keep-alive - blocked then allowed] ==="
( (printf 'GET / HTTP/1.1\r\nHost: blocked.example.com\r\n\r\n'; sleep 1
  printf 'GET / HTTP/1.1\r\nHost: keepalive.wildcard.example.com\r\nConnection: close\r\n\r\n'; sleep 1) \
  | nc -w 5 allowed.example.com 80 > /dev/null 2>&1 || true) &
echo "  requests sent (the second must be logged as allowed)"

# A ClientHello with no SNI extension at all. There is no name to judge, so
# the connection is blocked on that alone, against the address it was headed
# for, which is the proxy's own.
echo "=== [HTTPS - missing-sni] ==="
(printf '\026\003\001\000\055\001\000\000\051\003\001\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\002\000\377\001\000' \
  | nc -w 5 allowed.example.com 443 > /dev/null 2>&1 || true)
echo "  request sent (a missing-sni block expected)"

echo "=== [HTTP - missing-host-header] ==="
( (printf 'GET / HTTP/1.0\r\n\r\n'; sleep 1) | nc -w 5 allowed.example.com 80 > /dev/null 2>&1 || true) &
echo "  request sent (a missing-host-header block expected)"

# SNI = x" -\n[T] buildcage [ALLOWED] (HTTPS) "forged.example.com, which tries
# to break out of the "..." quoting and put a fabricated ALLOWED line in the
# log. It must come out as one blocked line with the payload sanitized.
echo "=== [HTTPS - forged SNI] ==="
(printf '\026\003\001\000\160\001\000\000\154\003\003\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\002\000\377\001\000\000\101\000\000\000\075\000\073\000\000\070\170\042\040\055\012\133\124\135\040\142\165\151\154\144\143\141\147\145\040\133\101\114\114\117\127\105\104\135\040\050\110\124\124\120\123\051\040\042\146\157\162\147\145\144\056\145\170\141\155\160\154\145\056\143\157\155' \
  | nc -w 5 allowed.example.com 443 > /dev/null 2>&1 || true)
echo "  request sent (one sanitized invalid-sni block expected)"

echo "=== [HTTPS - SNI holding a colon] ==="
(sni_colon_hello \
  | nc -w 5 allowed.example.com 443 > /dev/null 2>&1 || true)
echo "  request sent (an invalid-sni block expected)"

# The same name in a plaintext Host. Only the last `:port` is a port.
echo "=== [HTTP - Host holding a colon] ==="
( (printf 'GET / HTTP/1.1\r\nHost: tlsany.example.com:x.evil.example.net:80\r\nConnection: close\r\n\r\n'; sleep 1) \
  | nc -w 5 allowed.example.com 80 > /dev/null 2>&1 || true) &
echo "  request sent (an invalid-host block expected)"

wait
echo "=== [The cases run alongside the rest] ==="
check_blocked "nxdomain.wildcard.example.com" "$(cat "$SLOW/nxdomain-https")"
check_blocked "v6only.wildcard.example.com" "$(cat "$SLOW/v6only-https")"
check_status "nxdomain.wildcard.example.com HTTP" "$(cat "$SLOW/nxdomain-http")" "503"
check_status "v6only.wildcard.example.com HTTP" "$(cat "$SLOW/v6only-http")" "503"
rm -rf "$SLOW"

scenario_results "universal restrict scenarios"
