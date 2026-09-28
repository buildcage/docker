#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/helpers.sh"

LOGS=$(builder_log haproxy)

echo ""
echo "=== Inspect Proxy Engine Assertions (audit) ==="
echo ""

echo "[audit records everything, whatever the rules allow]:"
assert_logged GET "https://allowed.example.com/public/pkg.tgz" 200
assert_logged POST "https://api.example.com/v1/thing" 200
assert_logged GET "https://allowed.example.com:9443/private/secret" 200
assert_logged GET "http://allowed.example.com:9080/public/pkg.tgz" 200
assert_logged GET "https://blocked.example.com/exfil?token=SECRET-VALUE" 200
echo ""

echo "[audit enforces nothing]:"
if grep -qE "^buildcage [0-9]+ https? [A-Z]+ (403|502) " <<< "$LOGS"; then
  fail "something was refused in audit mode"
  grep -E "(403|502) " <<< "$LOGS" || true
else
  pass "no request was refused"
fi
echo ""

echo "[a rule naming an address exempts it from the internal-address guard in audit too]:"
if docker compose exec builder grep -qF "set-var(txn.named_address) bool(true)" /etc/haproxy/haproxy.cfg; then
  pass "GET http://10.200.0.100/pub-by-addr/** carried its exemption into haproxy.cfg"
else
  fail "no address exemption in haproxy.cfg, so audit refuses what restrict allows"
fi
echo ""

echo "[undeclared ports] classified by content, with no port declared as either:"
if grep -qE "dst=10\.200\.0\.100:9443 " <<< "$LOGS" \
  && grep -qE "dst=10\.200\.0\.100:9080 " <<< "$LOGS"; then
  pass "TLS on 9443 and plaintext on 9080 both reached the origin on their own port"
else
  fail "an undeclared port did not survive to the origin connection"
fi
echo ""

REPORT_MARKDOWN=$(GITHUB_STEP_SUMMARY= node report/src/main.ts 2>&1 || true)

echo "[report] the log reads as complete:"
assert_report_complete "$REPORT_MARKDOWN"
echo ""

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
# These rules are meant to be pasted into a restrict run, so they are checked
# against what the build actually did rather than only for being present.
if grep -qF "Switch to restrict mode" <<< "$REPORT_MARKDOWN" \
  && grep -qF "allowed_url_rules: |" <<< "$REPORT_MARKDOWN"; then
  pass "the example is offered as URL rules"
else
  fail "no restrict-mode URL rule example was rendered"
fi

RULES=$(
  awk '
    # Stops at the next top-level key (allowed_tls_rules/allowed_ip_rules are
    # echoed into the same fenced block, see inspect-example.ts) as well as
    # the closing fence, so only the allowed_url_rules value is captured.
    /allowed_url_rules: \|/ { capture=1; next }
    capture && /^ *(allowed_tls_rules|allowed_ip_rules): \|/ { exit }
    capture && /```/ { exit }
    capture { print }
  ' <<< "$REPORT_MARKDOWN" | sed 's/^ *//'
)
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
# report/src/main.ts normally does itself from upload_traffic_artifact; set
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
      // audit makes no allow decision, so saying "allow" would claim one. A
      // discovery lookup is decided by no rule at all, in either mode.
      const ok = requests.some((r) => r.method === "POST")
        && requests.some((r) => (r.url || "").includes(":9080/"))
        && requests.every((r) => r.status === 200)
        && rows.every((r) => r.action === "audit" || r.action === "discovery");
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

assert_results
