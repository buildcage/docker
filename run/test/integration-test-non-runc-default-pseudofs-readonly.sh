#!/bin/bash
# Verifies that a real pseudo-filesystem mount NOT among runc's own default
# base-spec mounts (see freshMountDestinationsFrom in sandbox/oci-config.ts) is
# still forced read-only inside the sandbox, rather than being silently
# tolerated just because it superficially looks like a "kernel pseudo-fs".
# securityfs is a concrete, realistic example: it's commonly mounted at
# /sys/kernel/security on AppArmor-enabled hosts (the default on GitHub
# Actions' Ubuntu runner images), but runc's default spec never declares a
# mount for it. This test synthesizes an equivalent mount at a throwaway
# location outside every writable exception, since remounting the real
# /sys/kernel/security wouldn't be safe to do from a test script.
set -uo pipefail

: "${BUILDCAGE_LOCAL_IMAGE_REF:?BUILDCAGE_LOCAL_IMAGE_REF must be set to the locally built proxy image}"

# Deliberately under /var/tmp, not /tmp: /tmp is always a writable
# exception, which would defeat the point of this test.
MOUNT_POINT="/var/tmp/buildcage-securityfs-test-$$"
mkdir -p "$MOUNT_POINT"
WORKDIR=$(mktemp -d)

cleanup() {
  sudo -n umount "$MOUNT_POINT" >/dev/null 2>&1
  rmdir "$MOUNT_POINT" 2>/dev/null
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

sudo -n mount -t securityfs securityfs "$MOUNT_POINT"
touch "$WORKDIR/state.env" "$WORKDIR/summary.md"

GITHUB_WORKSPACE="$WORKDIR" \
GITHUB_STATE="$WORKDIR/state.env" \
GITHUB_STEP_SUMMARY="$WORKDIR/summary.md" \
BUILDCAGE_BUILD_TEST_HOOKS=1 \
BUILDCAGE_LOCAL_IMAGE_REF="$BUILDCAGE_LOCAL_IMAGE_REF" \
INPUT_RUN="mp='$MOUNT_POINT'
[ -d \"\$mp\" ] || { echo 'UNEXPECTED: securityfs mount point not visible in sandbox'; exit 1; }
# securityfs's own directory entries are populated by kernel LSM
# subsystems, not user-creatable, so attempting to create a new file
# there fails with EACCES regardless of the mount's ro/rw status -- that
# wouldn't distinguish a fixed sandbox from a broken one. Check the actual
# mount options in this mount namespace instead.
opts=\$(awk -v mp=\"\$mp\" '\$5 == mp { last = \$6 } END { print last }' /proc/self/mountinfo)
case \",\$opts,\" in
  *,ro,*) echo 'OK: securityfs mount is read-only' ;;
  *) echo \"UNEXPECTED: securityfs mount options were '\$opts' (expected ro)\"; exit 1 ;;
esac
" \
  node run/dist/main.cjs
CODE=$?

echo ""
echo "=== Sandbox Non-runc-default Pseudo-FS Read-Only Assertion ==="
echo ""
if [ "$CODE" = "0" ]; then
  echo "  PASS  a real securityfs mount not among runc's own default mounts is forced read-only"
else
  echo "  FAIL  securityfs read-only check failed (exit $CODE)"
  exit 1
fi
echo ""
