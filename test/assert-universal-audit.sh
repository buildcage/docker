#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/helpers.sh"

LOGS=$(builder_log haproxy)

echo ""
echo "=== Audit Mode Assertions ==="
echo ""

echo "[AUDIT] expected:"
assert_log_contains AUDIT "blocked.example.com:443" "-"
assert_log_contains AUDIT "blocked.example.com:80" "-"
assert_log_contains AUDIT "blocked.example.com:8443" "-"
assert_log_contains AUDIT "blocked.example.com:8080" "-"
assert_log_contains AUDIT "10.200.0.100:80" "-"
echo ""

echo "[BLOCKED] expected (protocol/infrastructure errors):"
assert_log_contains BLOCKED "nxdomain.wildcard.example.com:443" "dns-failed"
assert_log_contains BLOCKED "nxdomain.wildcard.example.com:80" "dns-failed"
assert_log_contains BLOCKED "198.19.255.1:443" "missing-sni"
assert_log_contains BLOCKED "198.19.255.1:80" "missing-host-header"
echo ""

echo "[BLOCKED] expected (internal-address guard, unconditional even in audit):"
assert_log_contains BLOCKED "internal.wildcard.example.com:443" "internal-address"
assert_log_contains BLOCKED "internal.wildcard.example.com:80" "internal-address"
assert_log_contains BLOCKED "runner.wildcard.example.com:443" "internal-address"
assert_log_contains BLOCKED "runner.wildcard.example.com:80" "internal-address"
echo ""

echo "[ALLOWED] must not exist:"
assert_log_not_contains ALLOWED
echo ""

REPORT_MARKDOWN=$(GITHUB_STEP_SUMMARY= node report/src/main.ts 2>&1 || true)

echo "[report] the log reads as complete:"
assert_report_complete "$REPORT_MARKDOWN"
echo ""

echo "[report] audit heading and the hosts that were reached:"
if grep -qF "### 📋 Audited Hosts" <<< "$REPORT_MARKDOWN" \
  && ! grep -qF "### ✅ Allowed Hosts" <<< "$REPORT_MARKDOWN" \
  && grep -qF "| blocked.example.com:443 | HTTPS |" <<< "$REPORT_MARKDOWN" \
  && grep -qF "| blocked.example.com:8080 | HTTP |" <<< "$REPORT_MARKDOWN" \
  && grep -qF "| 10.200.0.100:80 | IP |" <<< "$REPORT_MARKDOWN"; then
  pass "every host is audited rather than allowed, on its own port"
else
  fail "the Audited Hosts table is missing expected rows"
fi
echo ""

echo "[report] only the guards that fire in both modes reach the Blocked Hosts table:"
if grep -qF "### 🚫 Blocked Hosts" <<< "$REPORT_MARKDOWN" \
  && grep -qF "| internal.wildcard.example.com:443 | HTTPS | internal-address |" <<< "$REPORT_MARKDOWN"; then
  pass "the unconditional guard is reported with its reason"
else
  fail "the Blocked Hosts table is missing the guard row"
fi
# The other unconditional guard, and the one the proxy did not decide: audit
# reports it the same way restrict does, outside the blocked table.
if grep -qF "### ⚠️ Failed Connections" <<< "$REPORT_MARKDOWN" \
  && grep -qF "| nxdomain.wildcard.example.com:443 | HTTPS | dns-failed |" <<< "$REPORT_MARKDOWN"; then
  pass "an unresolvable name is reported outside the blocked table"
else
  fail "the Failed Connections table is missing the unresolvable name"
fi
# Every other reason comes from the rules, which audit does not apply.
if grep -qE '\| (not-allowed|ip-not-allowed) \|' <<< "$REPORT_MARKDOWN"; then
  fail "a host was reported as refused by the rules in audit mode"
else
  pass "no host was reported as refused by the rules"
fi
echo ""

echo "[report] the restrict-mode example built from what was observed:"
# These rules are meant to be pasted into a restrict run, so they are checked
# against what the build actually did rather than only for being present.
RULES=$(
  awk '/```yaml/ { capture=1; next }
       capture && /```/ { exit }
       capture { print }' <<< "$REPORT_MARKDOWN"
)
echo "  ---- generated rules ----"
sed 's/^/  /' <<< "$RULES"

# Every host the build reached, or tried to reach and failed only to resolve,
# comes back under the key its rule type names, and nothing else does: a rule
# for a host audit never saw would be invented, and one under the wrong key
# would not match in restrict mode.
assert_rules() {
  local key="$1" expected="$2" actual
  actual=$(
    awk -v key="$key:" '
      $1 == key { capture=1; next }
      capture && /^ *[a-z_]+:/ { exit }
      capture { print $1 }
    ' <<< "$RULES" | sort | tr '\n' ' '
  )
  actual="${actual% }"
  if [ "$actual" = "$expected" ]; then
    pass "$key: $actual"
  else
    fail "$key: expected \"$expected\", got \"$actual\""
  fi
}

if grep -qF "Switch to restrict mode" <<< "$REPORT_MARKDOWN" \
  && grep -qF "proxy_mode: restrict" <<< "$REPORT_MARKDOWN" \
  && grep -qF "proxy_engine: universal" <<< "$REPORT_MARKDOWN"; then
  pass "a restrict-mode example was rendered, naming the non-default engine"
else
  fail "no restrict-mode example was rendered"
fi
assert_rules allowed_https_rules "blocked.example.com:443 blocked.example.com:8443 nxdomain.wildcard.example.com:443"
assert_rules allowed_http_rules "blocked.example.com:80 blocked.example.com:8080 nxdomain.wildcard.example.com:80"
assert_rules allowed_ip_rules "10.200.0.100:80"
echo ""

assert_results
