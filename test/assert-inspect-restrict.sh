#!/bin/bash
set -euo pipefail

FAILURES=0
PROXY_LOG=$(docker compose exec builder cat /var/log/haproxy/current 2>/dev/null)
DNS_LOG=$(docker compose exec builder cat /var/log/coredns/current 2>/dev/null)

pass() { echo "  PASS  $1"; }
fail() {
  echo "  FAIL  $1"
  FAILURES=$((FAILURES + 1))
}

# The log line is buildcage's own format (see haproxy-config.ts), so these
# match on it exactly rather than on a substring that could drift.
assert_logged() {
  local method="$1" url="$2" status="$3"
  if grep -qE "^buildcage [0-9]+ https? ${method} $(esc "$url") ${status} " <<< "$PROXY_LOG"; then
    pass "[$status] $method $url"
  else
    fail "[$status] $method $url -- no such line in the proxy log"
  fi
}

esc() { printf '%s' "$1" | sed 's/[][\.*^$?+(){}|/]/\\&/g'; }

echo ""
echo "=== Inspect Proxy Engine Assertions (restrict) ==="
echo ""

echo "[allowed] recorded with the method and the full URL:"
assert_logged GET "https://allowed.example.com/public/pkg.tgz" 200
assert_logged POST "https://api.example.com/v1/thing" 200
assert_logged DELETE "https://sub.wildcard.example.com/anything/at/all" 200
assert_logged GET "http://allowed.example.com/public/pkg.tgz" 200
echo ""

echo "[refused] recorded with the method and the full URL, before any origin was contacted:"
assert_logged GET "https://allowed.example.com/private/secret" 403
assert_logged POST "https://allowed.example.com/public/pkg.tgz" 403
assert_logged GET "https://absent.example.com/" 502
echo ""

echo "[traversal] the path is normalised before the rules see it:"
# Whether the proxy logs the raw or the normalised path, what must never appear
# is a 200: that would mean the origin served /private/ for a /public/ rule.
if grep -qE "^buildcage [0-9]+ https GET https://allowed\.example\.com/(public/\.\./)?private/secret 403 " <<< "$PROXY_LOG"; then
  pass "GET /public/../private/secret was refused"
else
  fail "GET /public/../private/secret -- no 403 recorded"
fi
echo ""

echo "[exfiltration] the query string is kept, which is where the payload goes:"
if grep -qF "https://blocked.example.com/exfil?token=SECRET-VALUE" <<< "$PROXY_LOG"; then
  pass "the refused URL was recorded with its query string intact"
else
  fail "the refused URL's query string was not recorded"
fi
echo ""

echo "[non-standard port] the original port survives to the origin connection:"
if grep -qE "^buildcage [0-9]+ https GET https://allowed\.example\.com:9443/public/pkg\.tgz 200 [0-9]+ ts=\S+ dst=10\.200\.0\.100:9443$" <<< "$PROXY_LOG"; then
  pass "reached 10.200.0.100:9443, not the listener's own port"
else
  fail "9443 did not survive to the origin connection"
  grep -E "9443" <<< "$PROXY_LOG" || true
fi
echo ""

echo "[forged Host] the destination came from our resolution, not the client's:"
if grep -qE "^buildcage [0-9]+ https GET https://allowed\.example\.com/public/pkg\.tgz 200 [0-9]+ ts=\S+ dst=10\.200\.0\.100:443$" <<< "$PROXY_LOG"; then
  pass "connected to 10.200.0.100, the address we resolved"
else
  fail "no request recorded as reaching the resolved address"
fi
# A refused request never connected, so its dst is still where the client
# aimed. Only a request that got an answer proves anything was reached.
if grep -qE "^buildcage [0-9]+ https? [A-Z]+ \\S+ 2[0-9][0-9] [0-9]+ ts=\\S+ dst=10\\.200\\.0\\.101:" <<< "$PROXY_LOG"; then
  fail "a request reached the impostor at 10.200.0.101"
else
  pass "nothing reached the impostor at 10.200.0.101"
fi
echo ""

echo "[SSRF] an allowlisted name resolving inward is refused before connecting:"
if grep -qE "^buildcage [0-9]+ https GET https://metadata\.example\.com/latest/meta-data 403 [0-9]+ ts=PR dst=169\.254\.169\.254:443$" <<< "$PROXY_LOG"; then
  pass "the name passed the rules but the resolved metadata address was refused"
else
  fail "the internal-destination guard did not fire"
  grep -E "metadata" <<< "$PROXY_LOG" || true
fi
echo ""

echo "[address destination] reached without asking any resolver:"
if grep -qE "^buildcage [0-9]+ http GET http://10\.200\.0\.100/pub-by-addr/x 200 [0-9]+ ts=-- dst=10\.200\.0\.100:80$" <<< "$PROXY_LOG"; then
  pass "a rule naming an address reached it, and the path rule still applied"
else
  fail "the address destination was not reached"
fi
# Asking would fail, since no resolver can answer an address; it also put a
# confusing "name refused" line in the report.
if grep -qE "name=10\.200\.0\.100" <<< "$DNS_LOG"; then
  fail "the resolver was asked about an address"
else
  pass "no resolver was asked about the address"
fi
echo ""

echo "[TLS passthrough] recorded, but never decrypted:"
# It has to appear, or the one thing a build was explicitly allowed to tunnel
# would be the one thing the report cannot show.
if grep -qE "^buildcage [0-9]+ pass tls sni=tlspass\.example\.com [0-9]+ ts=" <<< "$PROXY_LOG"; then
  pass "recorded as an undecrypted passthrough, with its byte count"
else
  fail "the passthrough was not recorded at all"
fi
# A request line for it would mean the TLS was terminated after all.
if grep -qE "^buildcage [0-9]+ https? [A-Z]+ \S*tlspass\.example\.com" <<< "$PROXY_LOG"; then
  fail "a passthrough connection was decrypted and logged as a request"
else
  pass "no request-level record, so nothing was decrypted"
fi
# Everything not passed through is recorded by the frontend that terminates it,
# so nothing else may appear at the tcp stage or it would be counted twice.
# The count is not asserted: a reused container's log spans several builds.
OTHER=$(grep -E "^buildcage [0-9]+ pass " <<< "$PROXY_LOG" \
  | grep -cv "sni=tlspass\.example\.com" || true)
if [ "$OTHER" -eq 0 ]; then
  pass "only the passthrough is logged at the tcp stage"
else
  fail "found $OTHER tcp-stage lines for hosts that were not passed through"
fi
echo ""

echo "[DNS] a name outside the allowlist is refused and recorded:"
if grep -qiF "buildcage dns denied name=SECRET-IN-A-NAME.attacker.example" <<< "$DNS_LOG"; then
  pass "the exfiltration name was refused by the resolver"
else
  fail "the exfiltration name was not recorded as refused"
fi
if grep -qiF "buildcage dns allowed name=allowed.example.com" <<< "$DNS_LOG"; then
  pass "an allowlisted name was forwarded"
else
  fail "no allowlisted name was recorded as forwarded"
fi
echo ""

echo "[UDP] the echo server the build could not reach is reachable from beside it:"
# Without this control, a build that reached nothing would pass even if the
# fixture were simply dead.
UDP_REPLY=$(docker compose exec -T test-dns sh -c \
  'echo probe | nc -u -w 3 10.200.0.102 9999' 2>/dev/null | tr -d '\r\n' || true)
if [ "$UDP_REPLY" = "probe" ]; then
  pass "the echo server answers on test-net, so the build's silence was the cage"
else
  fail "the echo server did not answer from test-net either (got \"$UDP_REPLY\")"
fi
echo ""

# report-action.js renders the full stepSummary itself; report/src/main.ts just
# relays it. GITHUB_STEP_SUMMARY is unset so it prints to stdout instead.
REPORT_MARKDOWN=$(GITHUB_STEP_SUMMARY= node report/src/main.ts 2>&1 || true)

echo "[report] Allowed Hosts:"
if grep -qF "### ✅ Allowed Hosts" <<< "$REPORT_MARKDOWN" \
  && grep -qF "| allowed.example.com:443 | HTTPS |" <<< "$REPORT_MARKDOWN" \
  && grep -qF "| allowed.example.com:80 | HTTP |" <<< "$REPORT_MARKDOWN"; then
  pass "the table lists the hosts that were reached"
else
  fail "the Allowed Hosts table is missing expected rows"
fi
echo ""

echo "[report] Blocked Hosts, including a name that never reached the proxy:"
if grep -qF "### 🚫 Blocked Hosts" <<< "$REPORT_MARKDOWN" \
  && grep -qF "| blocked.example.com:443 | HTTPS | not-allowed |" <<< "$REPORT_MARKDOWN" \
  && grep -qF "| absent.example.com:443 | HTTPS | dns-failed |" <<< "$REPORT_MARKDOWN" \
  && grep -qiF "| secret-in-a-name.attacker.example | DNS | dns-not-allowed |" <<< "$REPORT_MARKDOWN"; then
  pass "the table separates a refused request, an unresolvable name and a refused name"
else
  fail "the Blocked Hosts table is missing expected rows"
fi
echo ""

echo "[report] one timeline, with everything the build did in order:"
if grep -qF "Communication details" <<< "$REPORT_MARKDOWN" \
  && grep -qF "✅ " <<< "$REPORT_MARKDOWN" \
  && grep -qF "🚫 " <<< "$REPORT_MARKDOWN"; then
  pass "allowed and refused are interleaved rather than split"
else
  fail "the Communication details section is missing or still split"
fi

# A refusal names why: 403, 502 and 503 mean different things and the number
# does not say which.
if grep -qF "POST https://allowed.example.com/public/pkg.tgz -> not-allowed" <<< "$REPORT_MARKDOWN" \
  && grep -qF "https://absent.example.com/ -> dns-failed" <<< "$REPORT_MARKDOWN" \
  && grep -qF "https://blocked.example.com/exfil?token=SECRET-VALUE -> not-allowed" <<< "$REPORT_MARKDOWN"; then
  pass "a refusal names its reason and keeps its full URL"
else
  fail "a refusal is missing its reason or its URL"
fi

# A passthrough is never decrypted, so this is the only place it can appear.
if grep -qE 'TLS tlspass\.example\.com:443 -> \([0-9.]+[A-Za-z]+\)' <<< "$REPORT_MARKDOWN"; then
  pass "an undecrypted passthrough is in the timeline with its byte count"
else
  fail "the passthrough is missing from the timeline"
fi

if grep -qF "DNS secret-in-a-name.attacker.example -> dns-not-allowed" <<< "$REPORT_MARKDOWN"; then
  pass "a refused name is in the timeline, having no other trace"
else
  fail "the refused name is missing from the timeline"
fi

# Listing a name that resolved doubles every line, and the request that
# followed already says it did.
if grep -qE 'DNS allowed\.example\.com ->' <<< "$REPORT_MARKDOWN"; then
  fail "a name that merely resolved is in the timeline"
else
  pass "a name that merely resolved is left out"
fi
echo ""

echo "[report] the traffic artifact:"
# writeTrafficFile only runs when BUILDCAGE_TRAFFIC_FILE is set, which
# report/src/main.ts normally does itself from upload_traffic_artifact -- set
# it directly here to reach the same path without a real GitHub Actions
# runtime to upload through.
BUILDER_CID=$(docker compose ps -q builder)
SCRATCH_DIR=$(mktemp -d)
docker cp "$BUILDER_CID:/opt/buildcage/scripts/report-action.js" "$SCRATCH_DIR/report-action.js" 2>/dev/null
TRAFFIC_FILE="$SCRATCH_DIR/traffic.json"
GITHUB_STEP_SUMMARY= BUILDCAGE_TRAFFIC_FILE="$TRAFFIC_FILE" \
  node "$SCRATCH_DIR/report-action.js" "$BUILDER_CID" >/dev/null 2>&1 || true
TRAFFIC=$(cat "$TRAFFIC_FILE" 2>/dev/null || true)
if [ -n "$TRAFFIC" ] \
  && echo "$TRAFFIC" | node -e '
      const rows = JSON.parse(require("fs").readFileSync(0, "utf8"));
      const need = [
        // Filtering is on action, never on status: a refusal has no status.
        (r) => r.action === "block" && r.method === "POST" && r.status === undefined,
        (r) => r.action === "block" && (r.url || "").includes("token=SECRET-VALUE"),
        (r) => r.action === "allow" && r.protocol === "https" && r.status === 200 && r.bytes > 0,
        // Only inspect can report these two at all.
        (r) => r.protocol === "tls" && r.host === "tlspass.example.com" && r.bytes > 0,
        (r) => r.protocol === "dns" && r.action === "block" && r.reason === "dns-not-allowed",
        // Unlike the summary, the JSON keeps names that merely resolved.
        (r) => r.protocol === "dns" && r.action === "allow",
      ];
      const ok = need.every((f) => rows.some(f))
        && rows.every((r) => r.time && r.action && r.protocol && r.host)
        && rows.every((r) => r.protocol !== "dns" || r.port === undefined)
        && rows.every((r) => r.action !== "block" || r.reason)
        && rows.every((r, i) => i === 0 || rows[i - 1].time <= r.time);
      process.exit(ok ? 0 : 1);
    '; then
  pass "valid JSON, time-ordered, with action/protocol/host on every record"
else
  echo "  ---- traffic.json ----"
  cat "$TRAFFIC_FILE" 2>/dev/null || echo "(missing)"
  fail "the traffic artifact is missing or malformed"
fi
rm -rf "$SCRATCH_DIR"
echo ""

if [ "$FAILURES" -gt 0 ]; then
  echo "❌ FAILED: $FAILURES assertion(s) failed"
  exit 1
fi
echo "✅ All assertions passed."
echo ""
