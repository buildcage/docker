#!/bin/bash
# Verifies default privilege drop and filesystem policy by driving
# run/dist/main.cjs directly, without the real action wrapper -- see
# test-e2e.yml's test_sandbox_enforcement for the one case that does.
set -uo pipefail

: "${BUILDCAGE_LOCAL_IMAGE_REF:?BUILDCAGE_LOCAL_IMAGE_REF must be set to the locally built proxy image}"

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT
touch "$WORKDIR/state.env"

GITHUB_WORKSPACE="$WORKDIR" \
GITHUB_STATE="$WORKDIR/state.env" \
GITHUB_STEP_SUMMARY="$WORKDIR/summary.md" \
BUILDCAGE_BUILD_TEST_HOOKS=1 \
BUILDCAGE_LOCAL_IMAGE_REF="$BUILDCAGE_LOCAL_IMAGE_REF" \
INPUT_RUN="grep -q '^CapEff:[[:space:]]*0000000000000000\$' /proc/self/status
grep -q '^NoNewPrivs:[[:space:]]*1\$' /proc/self/status
echo x >> \"\$GITHUB_WORKSPACE/.buildcage-writable-test\"
echo x >> \"\$HOME/.buildcage-writable-test\"
echo x >> /tmp/.buildcage-writable-test
if touch /opt/.buildcage-writable-test 2>/dev/null; then
  echo UNEXPECTED: /opt was writable without a writable: entry
  exit 1
fi" \
  node run/dist/main.cjs
CODE=$?

echo ""
echo "=== Sandbox Default Privilege/Filesystem Assertions ==="
echo ""
if [ "$CODE" = "0" ]; then
  echo "  PASS  capabilities dropped, no_new_privs set, default writable/read-only filesystem policy correct"
else
  echo "  FAIL  default privilege/filesystem check failed (exit $CODE)"
  exit 1
fi
echo ""
