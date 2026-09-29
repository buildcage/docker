#!/bin/bash
# RUN steps share the buildcage0 bridge, and only a host that passes bridged
# traffic through iptables (br_netfilter) filters what one sends another. Each
# step's port is therefore isolated (cni.conflist's portIsolation), which the
# bridge enforces itself. buildkitd keeps a pool of network namespaces already
# attached (buildkitd.toml's cniPoolSize), so their ports are there to read
# without running a build.
set -uo pipefail
source "$(dirname "$0")/helpers.sh"

: "${BUILDER_NAME:?BUILDER_NAME must name the running builder}"

echo ""
echo "=== RUN step port isolation Assertions ==="
echo ""

flags=""
for _ in $(seq 1 30); do
  flags=$(docker exec "$BUILDER_NAME" sh -c 'cat /sys/class/net/buildcage0/brif/*/isolated' 2>/dev/null || true)
  [ -n "$flags" ] && break
  sleep 1
done

if [ -z "$flags" ]; then
  fail "no port appeared on buildcage0"
elif printf '%s\n' "$flags" | grep -qvx 1; then
  fail "a port on buildcage0 is not isolated: $(printf '%s' "$flags" | tr '\n' ' ')"
else
  pass "every port on buildcage0 is isolated"
fi

assert_results
