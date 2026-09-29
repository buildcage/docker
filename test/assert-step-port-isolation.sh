#!/bin/bash
# RUN steps share the buildcage0 bridge, and only a host that passes bridged
# traffic through iptables (br_netfilter) filters what one sends another. Each
# step's port is therefore isolated (cni.conflist's portIsolation), which the
# bridge enforces itself. This holds two RUN steps open and reads each port's
# flag from inside the builder.
set -uo pipefail
source "$(dirname "$0")/helpers.sh"

cd "$(dirname "$0")/.."

: "${BUILDER_NAME:?BUILDER_NAME must name the running builder}"

echo ""
echo "=== RUN step port isolation Assertions ==="
echo ""

docker buildx build --no-cache \
  --builder "$BUILDER_NAME" \
  --platform "${TEST_PLATFORM:-linux/amd64}" \
  --progress=plain -f test/Dockerfile.step-port-isolation test/ >/dev/null 2>&1 &
BUILD_PID=$!

flags=""
for _ in $(seq 1 30); do
  flags=$(docker exec "$BUILDER_NAME" sh -c 'cat /sys/class/net/buildcage0/brif/*/isolated' 2>/dev/null || true)
  [ "$(printf '%s\n' "$flags" | grep -c .)" -ge 2 ] && break
  sleep 1
done
wait "$BUILD_PID"
BUILD_CODE=$?

if [ -z "$flags" ]; then
  fail "no RUN step's port appeared on buildcage0"
elif printf '%s\n' "$flags" | grep -qvx 1; then
  fail "a RUN step's port on buildcage0 is not isolated: $(printf '%s' "$flags" | tr '\n' ' ')"
else
  pass "every RUN step's port on buildcage0 is isolated"
fi
if [ "$BUILD_CODE" = "0" ]; then
  pass "the build succeeded"
else
  fail "the build failed (exit $BUILD_CODE)"
fi

assert_results
