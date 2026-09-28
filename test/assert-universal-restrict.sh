#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/helpers.sh"

LOGS=$(builder_log haproxy)

echo ""
echo "=== Restrict Mode Assertions ==="
echo ""

echo "[ALLOWED] expected:"
assert_log_contains ALLOWED "allowed.example.com:443" "-"
assert_log_contains ALLOWED "sub.wildcard.example.com:443" "-"
assert_log_contains ALLOWED "sub.wildcard.example.com:80" "-"
assert_log_contains ALLOWED "allowed.example.com:80" "-"
assert_log_contains ALLOWED "allowed.example.com:8443" "-"
assert_log_contains ALLOWED "allowed.example.com:8080" "-"
assert_log_contains ALLOWED "ALLOWED.example.com:443" "-"
assert_log_contains ALLOWED "ALLOWED.example.com:80" "-"
assert_log_contains ALLOWED "ok.regex.example.com:443" "-"
assert_log_contains ALLOWED "ports.regex.example.com:443" "-"
assert_log_contains ALLOWED "ports.regex.example.com:8443" "-"
assert_log_contains ALLOWED "10.200.0.100:8443" "-"
echo ""

echo "[BLOCKED] expected:"
assert_log_contains BLOCKED "blocked.example.com:443" "not-allowed"
assert_log_contains BLOCKED "blocked.example.com:80" "not-allowed"
assert_log_contains BLOCKED "blocked.example.com:8443" "not-allowed"
assert_log_contains BLOCKED "blocked.example.com:8080" "not-allowed"
assert_log_contains BLOCKED "deep.sub.wildcard.example.com:443" "not-allowed"
assert_log_contains BLOCKED "not-ok.regex.example.com:443" "not-allowed"
assert_log_contains BLOCKED "ports.regex.example.com:80" "not-allowed"
assert_log_contains BLOCKED "10.200.0.100:80" "ip-not-allowed"
assert_log_contains BLOCKED "10.200.0.101:8443" "ip-not-allowed"
assert_log_contains BLOCKED "nxdomain.wildcard.example.com:443" "dns-failed"
assert_log_contains BLOCKED "nxdomain.wildcard.example.com:80" "dns-failed"
assert_log_contains BLOCKED "v6only.wildcard.example.com:443" "dns-failed"
assert_log_contains BLOCKED "v6only.wildcard.example.com:80" "dns-failed"
assert_log_contains BLOCKED "198.19.255.1:443" "missing-sni"
assert_log_contains BLOCKED "198.19.255.1:80" "missing-host-header"
assert_log_contains BLOCKED "internal.wildcard.example.com:443" "internal-address"
assert_log_contains BLOCKED "internal.wildcard.example.com:80" "internal-address"
assert_log_contains BLOCKED "runner.wildcard.example.com:443" "internal-address"
assert_log_contains BLOCKED "runner.wildcard.example.com:80" "internal-address"
echo ""

echo "[BLOCKED] forged SNI, sanitized to a single log line:"
assert_log_contains BLOCKED "x__-__T__buildcage__ALLOWED___HTTPS___forged.example.com:443" "invalid-sni"
echo ""

echo "[BLOCKED] an SNI holding a colon, before a ~ rule's port pattern can match it:"
assert_log_contains BLOCKED "tlsany.example.com_x.evil.example.net:443" "invalid-sni"
echo ""

echo "[keep-alive] txn.decision/txn.reason must not leak across requests on one connection:"
assert_log_not_matching ALLOWED "blocked.example.com:80"
assert_log_not_matching ALLOWED "allowed.example.com:80" "not-allowed"
echo ""

echo "[AUDIT] must not exist:"
assert_log_not_contains AUDIT
echo ""

echo "[log integrity] no forged/malformed lines from the injection attempt:"
assert_no_forged_log_lines
echo ""

REPORT_MARKDOWN=$(GITHUB_STEP_SUMMARY= node report/src/main.ts 2>&1 || true)

echo "[report] the log reads as complete:"
assert_report_complete "$REPORT_MARKDOWN"
echo ""

echo "[report] Allowed Hosts:"
if grep -qF "### ✅ Allowed Hosts" <<< "$REPORT_MARKDOWN" \
  && grep -qF "| allowed.example.com:443 | HTTPS |" <<< "$REPORT_MARKDOWN" \
  && grep -qF "| allowed.example.com:80 | HTTP |" <<< "$REPORT_MARKDOWN"; then
  pass "the table lists the hosts that were reached, each on its own port"
else
  fail "the Allowed Hosts table is missing expected rows"
fi
echo ""

echo "[report] Blocked Hosts, one row per reason the proxy refused for:"
if grep -qF "### 🚫 Blocked Hosts" <<< "$REPORT_MARKDOWN" \
  && grep -qF "| blocked.example.com:443 | HTTPS | not-allowed |" <<< "$REPORT_MARKDOWN" \
  && grep -qF "| 10.200.0.100:80 | IP | ip-not-allowed |" <<< "$REPORT_MARKDOWN" \
  && grep -qF "| internal.wildcard.example.com:443 | HTTPS | internal-address |" <<< "$REPORT_MARKDOWN"; then
  pass "a name no rule covers, an address and an internal one each keep their reason"
else
  fail "the Blocked Hosts table is missing expected rows"
fi
echo ""

# The allowlist is checked before anything resolves, so a name that got as far
# as failing to resolve had passed it: no rule refused it and none can clear it.
echo "[report] Failed Connections, for a name the resolver could not answer:"
if grep -qF "### ⚠️ Failed Connections" <<< "$REPORT_MARKDOWN" \
  && grep -qF "| nxdomain.wildcard.example.com:443 | HTTPS | dns-failed |" <<< "$REPORT_MARKDOWN"; then
  pass "an unresolvable name is reported outside the blocked table"
else
  fail "the Failed Connections table is missing expected rows"
fi
echo ""

assert_results
