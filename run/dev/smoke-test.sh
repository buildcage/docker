#!/bin/sh
# Sample isolated command for `make test_sandbox_dev` — exercises the same
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

echo "=== sandbox escape: host / must not be re-exposed via the rootfs bind ==="
# The `mount --rbind /` rootfs lives under the bundle dir at
# /var/tmp/buildcage/dev-bundle/rootfs. Because /var/tmp is not one of the writable
# exceptions (only /tmp is bound writable), the writable rbinds don't
# recursively re-expose it, so this path stays empty inside the sandbox.
if [ -e /var/tmp/buildcage/dev-bundle/rootfs/etc ] || [ -e /var/tmp/buildcage/dev-bundle/rootfs/bin ]; then
  echo "UNEXPECTED: host / reachable via /var/tmp/buildcage/dev-bundle/rootfs (sandbox escape!)"
  ls -la /var/tmp/buildcage/dev-bundle/rootfs 2>/dev/null
  exit 1
else
  echo "OK: /var/tmp/buildcage/dev-bundle/rootfs is empty (host / not re-exposed)"
fi
if echo x > /var/tmp/buildcage/dev-bundle/rootfs/etc/.buildcage-escape 2>/dev/null; then
  echo "UNEXPECTED: wrote to host / via /var/tmp/buildcage/dev-bundle/rootfs (sandbox escape!)"
  exit 1
else
  echo "OK: cannot write host / via /var/tmp/buildcage/dev-bundle/rootfs"
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
