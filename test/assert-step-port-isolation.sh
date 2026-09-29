#!/bin/bash
# Every port on buildcage0 must be isolated (cni.conflist's portIsolation):
# without br_netfilter on the host, nothing else stops RUN steps reaching one
# another. buildkitd keeps pooled step namespaces attached (buildkitd.toml's
# cniPoolSize), so there are ports to read without running a build.
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
