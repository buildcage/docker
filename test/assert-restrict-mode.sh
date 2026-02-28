#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/helpers.sh"

echo ""
echo "=== Restrict Mode Assertions ==="
echo ""

echo "[ALLOWED] expected:"
assert_log_contains ALLOWED "allowed.example.com:443" "-"
assert_log_contains ALLOWED "sub.wildcard.example.com:443" "-"
assert_log_contains ALLOWED "allowed.example.com:80" "-"
assert_log_contains ALLOWED "allowed.example.com:8443" "-"
assert_log_contains ALLOWED "allowed.example.com:8080" "-"
echo ""

echo "[BLOCKED] expected:"
assert_log_contains BLOCKED "blocked.example.com:443" "not-allowed"
assert_log_contains BLOCKED "blocked.example.com:80" "not-allowed"
assert_log_contains BLOCKED "blocked.example.com:8443" "not-allowed"
assert_log_contains BLOCKED "blocked.example.com:8080" "not-allowed"
echo ""

echo "[AUDIT] must not exist:"
assert_log_not_contains AUDIT
echo ""

assert_results
echo ""
