#!/bin/bash
# Verifies writable: <dir> by driving run/dist/main.cjs directly, without
# the real action wrapper -- see test-e2e.yml's test_sandbox_enforcement
# for the one case that does exercise the real action.
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
INPUT_WRITABLE="/opt" \
INPUT_RUN="touch /opt/.buildcage-writable-test
rm -f /opt/.buildcage-writable-test" \
  node run/dist/main.cjs
CODE=$?

echo ""
echo "=== Sandbox writable:<dir> Assertions ==="
echo ""
if [ "$CODE" = "0" ]; then
  echo "  PASS  /opt is writable when listed under writable:"
else
  echo "  FAIL  /opt was not writable when listed under writable: (exit $CODE)"
  exit 1
fi
echo ""
