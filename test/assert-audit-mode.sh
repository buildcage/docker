#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/helpers.sh"

echo ""
echo "=== Audit Mode Assertions ==="
echo ""

echo "[AUDIT] expected:"
assert_log_contains AUDIT "blocked.example.com:443"
assert_log_contains AUDIT "blocked.example.com:80"
assert_log_contains AUDIT "blocked.example.com:8443"
assert_log_contains AUDIT "blocked.example.com:8080"
assert_log_contains AUDIT "10.200.0.100:80"
echo ""

echo "[BLOCKED] must not exist:"
assert_log_not_contains BLOCKED
echo ""

echo "[ALLOWED] must not exist:"
assert_log_not_contains ALLOWED
echo ""

assert_results
echo ""
