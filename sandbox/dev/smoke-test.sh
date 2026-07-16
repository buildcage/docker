#!/bin/sh
# Sample isolated command for `make test_sandbox_mode` — exercises the same
# checks the CI test_sandbox job performs, run from the mac dev loop instead.
set -e

echo "=== capability / privilege-escalation checks ==="
grep -E 'CapEff|NoNewPrivs' /proc/self/status

echo "=== allowlisted host must be reachable ==="
wget -q -T 5 -O /dev/null http://example.com/ && echo "OK: example.com reachable"

echo "=== non-allowlisted host must be blocked ==="
if wget -q -T 5 -O /dev/null http://neverssl.com/ 2>&1; then
  echo "UNEXPECTED: neverssl.com was reachable"
  exit 1
else
  echo "OK: neverssl.com correctly blocked"
fi
