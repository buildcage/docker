#!/bin/bash
# Verifies that a real filesystem separately mounted underneath a writable
# exception (here, a bind mount under $GITHUB_WORKSPACE) is still visible
# but individually forced read-only inside the sandbox -- the writable
# guarantee covers only the exception paths themselves
# (workdir/home/tmp/RUNNER_TEMP/writable:), not everything nested under
# them (see computeReadonlyHostMounts: protectedPaths is checked by exact
# match, not by prefix). Ordinary files/directories under workdir (not
# separate mount points) are already covered by
# integration-test-defaults.sh; this covers the separate-mount case
# specifically, which computeReadonlyHostMounts handles differently -- a
# regression guard against a future change that widened the writable
# exception into a mount-point prefix match instead of an exact one.
set -uo pipefail

: "${BUILDCAGE_LOCAL_IMAGE_REF:?BUILDCAGE_LOCAL_IMAGE_REF must be set to the locally built proxy image}"

WORKDIR=$(mktemp -d)
NESTED_SRC=$(mktemp -d)
MOUNT_POINT="$WORKDIR/nested-mount"
mkdir -p "$MOUNT_POINT"

cleanup() {
  sudo -n umount "$MOUNT_POINT" >/dev/null 2>&1
  rm -rf "$WORKDIR" "$NESTED_SRC"
}
trap cleanup EXIT

sudo -n mount --bind "$NESTED_SRC" "$MOUNT_POINT"
touch "$WORKDIR/state.env" "$WORKDIR/summary.md"

GITHUB_WORKSPACE="$WORKDIR" \
GITHUB_STATE="$WORKDIR/state.env" \
GITHUB_STEP_SUMMARY="$WORKDIR/summary.md" \
BUILDCAGE_BUILD_TEST_HOOKS=1 \
BUILDCAGE_LOCAL_IMAGE_REF="$BUILDCAGE_LOCAL_IMAGE_REF" \
INPUT_RUN='mp="$GITHUB_WORKSPACE/nested-mount"
[ -d "$mp" ] || { echo "UNEXPECTED: nested mount point not visible in sandbox"; exit 1; }
if echo x > "$mp/.buildcage-nested-mount-test" 2>/dev/null; then
  echo "UNEXPECTED: nested mount under workdir was writable"
  exit 1
fi
echo "OK: nested mount under workdir is visible and read-only"
' \
  node run/dist/main.cjs
CODE=$?

echo ""
echo "=== Sandbox Nested-Mount-Read-Only Assertion ==="
echo ""
if [ "$CODE" = "0" ]; then
  echo "  PASS  a real mount nested under workdir is visible but forced read-only"
else
  echo "  FAIL  nested-mount read-only check failed (exit $CODE)"
  exit 1
fi
echo ""
