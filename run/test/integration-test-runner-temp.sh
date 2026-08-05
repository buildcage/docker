#!/bin/bash
# Verifies $RUNNER_TEMP is writable inside the sandbox by driving
# run/dist/main.cjs directly, without the real action wrapper -- see
# test-e2e.yml's test_sandbox_enforcement for the one case that does.
# buildOciConfig's RUNNER_TEMP handling is already unit-tested against the
# generated config.json; this proves runc actually honors it.
set -uo pipefail

: "${BUILDCAGE_LOCAL_IMAGE_REF:?BUILDCAGE_LOCAL_IMAGE_REF must be set to the locally built proxy image}"

WORKDIR=$(mktemp -d)
RUNNER_TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR" "$RUNNER_TEMP_DIR"' EXIT
touch "$WORKDIR/state.env" "$WORKDIR/summary.md"

GITHUB_WORKSPACE="$WORKDIR" \
GITHUB_STATE="$WORKDIR/state.env" \
GITHUB_STEP_SUMMARY="$WORKDIR/summary.md" \
RUNNER_TEMP="$RUNNER_TEMP_DIR" \
BUILDCAGE_BUILD_TEST_HOOKS=1 \
BUILDCAGE_LOCAL_IMAGE_REF="$BUILDCAGE_LOCAL_IMAGE_REF" \
INPUT_RUN='echo x > "$RUNNER_TEMP/.buildcage-runner-temp-test"
rm -f "$RUNNER_TEMP/.buildcage-runner-temp-test"' \
  node run/dist/main.cjs
CODE=$?

echo ""
echo "=== Sandbox \$RUNNER_TEMP Writable Assertion ==="
echo ""
if [ "$CODE" = "0" ]; then
  echo "  PASS  \$RUNNER_TEMP is writable inside the sandbox"
else
  echo "  FAIL  \$RUNNER_TEMP was not writable inside the sandbox (exit $CODE)"
  exit 1
fi
echo ""
