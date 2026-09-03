#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/helpers.sh"

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
assert_log_contains BLOCKED "172.20.0.1:443" "missing-sni"
assert_log_contains BLOCKED "172.20.0.1:80" "missing-host-header"
echo ""

echo "[BLOCKED] expected (internal-address guard, unconditional even in audit):"
assert_log_contains BLOCKED "internal.wildcard.example.com:443" "internal-address"
assert_log_contains BLOCKED "internal.wildcard.example.com:80" "internal-address"
echo ""

echo "[ALLOWED] must not exist:"
assert_log_not_contains ALLOWED
echo ""

assert_results
echo ""
