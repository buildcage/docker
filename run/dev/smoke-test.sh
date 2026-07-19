#!/bin/sh
# Sample isolated command for `make test_sandbox_mode` — exercises the same
# checks the CI test_sandbox job performs, run from the mac dev loop instead.
set -e

echo "=== capability / privilege-escalation checks ==="
if grep -q '^CapEff:[[:space:]]*0000000000000000$' /proc/self/status; then
  echo "OK: CapEff is fully cleared"
else
  echo "UNEXPECTED: CapEff is not fully cleared"
  grep 'CapEff' /proc/self/status
  exit 1
fi
if grep -q '^NoNewPrivs:[[:space:]]*1$' /proc/self/status; then
  echo "OK: NoNewPrivs is set"
else
  echo "UNEXPECTED: NoNewPrivs is not set"
  grep 'NoNewPrivs' /proc/self/status
  exit 1
fi

echo "=== filesystem policy: /tmp writable, root read-only elsewhere ==="
if echo x >> /tmp/.buildcage-smoke-writable-test; then
  echo "OK: /tmp is writable"
else
  echo "UNEXPECTED: /tmp was not writable"
  exit 1
fi
if touch /etc/.buildcage-smoke-should-fail 2>/dev/null; then
  echo "UNEXPECTED: /etc was writable"
  exit 1
else
  echo "OK: /etc is read-only"
fi

echo "=== allowlisted host must be reachable ==="
wget -q -T 5 -O /dev/null http://example.com/ && echo "OK: example.com reachable"

echo "=== non-allowlisted host must be blocked ==="
if wget -q -T 5 -O /dev/null http://neverssl.com/ 2>&1; then
  echo "UNEXPECTED: neverssl.com was reachable"
  exit 1
else
  echo "OK: neverssl.com correctly blocked"
fi
