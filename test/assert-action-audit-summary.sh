#!/bin/bash
# Checks the Job Summary of test-e2e.yml's audit-mode report step, copied to
# BUILDCAGE_TEST_SUMMARY_FILE by a test-hook build of the report action.
set -euo pipefail
source "$(dirname "$0")/helpers.sh"

SUMMARY=$(cat "$BUILDCAGE_TEST_SUMMARY_FILE")

echo ""
echo "=== Audit Mode Job Summary Assertions ==="
echo ""

assert_report_complete "$SUMMARY"

summary_contains() {
  if grep -qF -- "$1" <<< "$SUMMARY"; then
    pass "$2"
  else
    fail "$2 (missing: $1)"
  fi
}

summary_contains "### 📋 Audited Hosts" "the hosts are listed as audited"
summary_contains "| \`registry.npmjs.org:443\` | HTTPS |" "the HTTPS host is in the audited table"
summary_contains "| \`example.com:80\` | HTTP |" "the HTTP host is in the audited table"
summary_contains "Switch to restrict mode" "a restrict-mode example is rendered"
summary_contains "uses: buildcage/docker@" "the example uses the setup action"
summary_contains "proxy-mode: restrict" "the example sets proxy-mode: restrict"
summary_contains "proxy-engine: universal" "the example names the non-default engine"
summary_contains "allowed-https-rules:" "the example has allowed-https-rules"
summary_contains "registry.npmjs.org:443" "the example allows the HTTPS host"
summary_contains "allowed-http-rules:" "the example has allowed-http-rules"
summary_contains "example.com:80" "the example allows the HTTP host"

assert_results
