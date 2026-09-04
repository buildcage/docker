#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/helpers.sh"

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
echo ""

echo "[BLOCKED] expected:"
assert_log_contains BLOCKED "blocked.example.com:443" "not-allowed"
assert_log_contains BLOCKED "blocked.example.com:80" "not-allowed"
assert_log_contains BLOCKED "blocked.example.com:8443" "not-allowed"
assert_log_contains BLOCKED "blocked.example.com:8080" "not-allowed"
assert_log_contains BLOCKED "deep.sub.wildcard.example.com:443" "not-allowed"
assert_log_contains BLOCKED "10.200.0.100:80" "ip-not-allowed"
assert_log_contains BLOCKED "nxdomain.wildcard.example.com:443" "dns-failed"
assert_log_contains BLOCKED "nxdomain.wildcard.example.com:80" "dns-failed"
assert_log_contains BLOCKED "172.20.0.1:443" "missing-sni"
assert_log_contains BLOCKED "172.20.0.1:80" "missing-host-header"
assert_log_contains BLOCKED "internal.wildcard.example.com:443" "internal-address"
assert_log_contains BLOCKED "internal.wildcard.example.com:80" "internal-address"
echo ""

echo "[BLOCKED] forged SNI, sanitized to a single log line:"
assert_log_contains BLOCKED "x__-__T__buildcage__ALLOWED___HTTPS___forged.example.com:443" "not-allowed"
echo ""

echo "[keep-alive] sess.decision/sess.reason must not leak across requests on one connection:"
assert_log_not_matching ALLOWED "blocked.example.com:80"
assert_log_not_matching ALLOWED "allowed.example.com:80" "not-allowed"
echo ""

echo "[AUDIT] must not exist:"
assert_log_not_contains AUDIT
echo ""

echo "[log integrity] no forged/malformed lines from the injection attempt:"
assert_no_forged_log_lines
echo ""

assert_results
echo ""
