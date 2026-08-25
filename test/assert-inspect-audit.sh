#!/bin/bash
set -euo pipefail

FAILURES=0
PROXY_LOG=$(docker compose exec builder cat /var/log/haproxy/current 2>/dev/null)

pass() { echo "  PASS  $1"; }
fail() {
  echo "  FAIL  $1"
  FAILURES=$((FAILURES + 1))
}

esc() { printf '%s' "$1" | sed 's/[][\.*^$?+(){}|/]/\\&/g'; }

assert_logged() {
  local method="$1" url="$2"
  if grep -qE "^buildcage [0-9]+ https? ${method} $(esc "$url") 200 " <<< "$PROXY_LOG"; then
    pass "$method $url"
  else
    fail "$method $url -- no 200 recorded"
  fi
}

echo ""
echo "=== Inspect Proxy Engine Assertions (audit) ==="
echo ""

echo "[audit records everything, with no rules configured]:"
assert_logged GET "https://allowed.example.com/public/pkg.tgz"
assert_logged POST "https://api.example.com/v1/thing"
assert_logged GET "https://allowed.example.com:9443/private/secret"
assert_logged GET "http://allowed.example.com:9080/public/pkg.tgz"
assert_logged GET "https://blocked.example.com/exfil?token=SECRET-VALUE"
echo ""

echo "[audit enforces nothing]:"
if grep -qE "^buildcage [0-9]+ https? [A-Z]+ \\S+ (403|502) " <<< "$PROXY_LOG"; then
  fail "something was refused in audit mode"
  grep -E "(403|502) " <<< "$PROXY_LOG" || true
else
  pass "no request was refused"
fi
echo ""

echo "[undeclared ports] classified by content, with no port declared as either:"
if grep -qE "dst=10\.200\.0\.100:9443$" <<< "$PROXY_LOG" \
  && grep -qE "dst=10\.200\.0\.100:9080$" <<< "$PROXY_LOG"; then
  pass "TLS on 9443 and plaintext on 9080 both reached the origin on their own port"
else
  fail "an undeclared port did not survive to the origin connection"
fi
echo ""

REPORT_MARKDOWN=$(GITHUB_STEP_SUMMARY= node report/src/main.ts 2>&1 || true)

echo "[report] audit heading and the hosts that were reached:"
if grep -qF "### 📋 Audited Hosts" <<< "$REPORT_MARKDOWN" \
  && grep -qF "| allowed.example.com:443 | HTTPS |" <<< "$REPORT_MARKDOWN" \
  && grep -qF "| blocked.example.com:443 | HTTPS |" <<< "$REPORT_MARKDOWN" \
  && grep -qF "| allowed.example.com:9080 | HTTP |" <<< "$REPORT_MARKDOWN"; then
  pass "the audited table lists every host, on its own port"
else
  fail "the Audited Hosts table is missing expected rows"
fi
echo ""

echo "[report] nothing is reported as blocked:"
if grep -qF "### 🚫 Blocked Hosts" <<< "$REPORT_MARKDOWN"; then
  fail "audit produced a Blocked Hosts table"
else
  pass "no Blocked Hosts table"
fi
echo ""

echo "[report] the restrict-mode example built from what was observed:"
# The whole point of audit is that these rules can be pasted into a restrict
# run, so they are checked against what the build actually did rather than
# only for being present.
if grep -qF "Switch to restrict mode" <<< "$REPORT_MARKDOWN" \
  && grep -qF "proxy_engine: inspect" <<< "$REPORT_MARKDOWN" \
  && grep -qF "allowed_url_rules: |" <<< "$REPORT_MARKDOWN"; then
  pass "the example is offered as URL rules"
else
  fail "no restrict-mode URL rule example was rendered"
fi

RULES=$(sed -n '/allowed_url_rules: |/,/```/p' <<< "$REPORT_MARKDOWN" | sed '1d;$d' | sed 's/^ *//')
echo "  ---- generated rules ----"
sed 's/^/  /' <<< "$RULES"

# Enumerated hosts, minimal methods: nothing here may be a wildcard method or a
# host the build never reached.
if grep -qE '^\*' <<< "$RULES"; then
  fail "a rule permits any method"
else
  pass "no rule permits any method"
fi
if grep -qE 'https?://[^/]*\*' <<< "$RULES"; then
  fail "a rule generalises a host"
else
  pass "no rule generalises a host"
fi
# The three paths reached over 443 share /public and nothing more, so that is
# what a rule keeps. A single observed path stays exact instead of widening,
# which is why the 9443 and 9080 rules name their file.
if grep -qF "POST https://api.example.com/v1/thing" <<< "$RULES" \
  && grep -qE '^GET https://allowed\.example\.com/public/\*\*$' <<< "$RULES" \
  && grep -qF "GET https://allowed.example.com:9443/private/secret" <<< "$RULES" \
  && grep -qF "GET http://allowed.example.com:9080/public/pkg.tgz" <<< "$RULES"; then
  pass "methods, ports and the collapsed prefix are all as observed"
else
  fail "the generated rules do not match what the build did"
fi

# The exfiltration attempt is in there too, which is the point of reading them.
if grep -qF "GET https://blocked.example.com/exfil" <<< "$RULES"; then
  pass "a host audit merely observed is listed, for the reader to remove"
else
  fail "an observed host is missing from the rules"
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
      const requests = rows.filter((r) => r.protocol === "https" || r.protocol === "http");
      // audit makes no allow decision, so saying "allow" would claim one.
      const ok = requests.some((r) => r.method === "POST")
        && requests.some((r) => (r.url || "").includes(":9080/"))
        && requests.every((r) => r.status === 200)
        && rows.every((r) => r.action === "audit");
      process.exit(ok ? 0 : 1);
    '; then
  pass "valid JSON, every record audited, covering each method and port observed"
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
