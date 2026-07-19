#!/bin/bash
# Verifies the Docker-default-profile-derived seccomp filter actually
# blocks the two syscall classes docs/security.md names as motivating
# examples (unprivileged user-namespace creation, io_uring) by driving
# run/dist/main.cjs directly, without the real action wrapper — see
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
INPUT_RUN='set -e
echo "=== unshare -U (unprivileged user-namespace creation) must be blocked ==="
if unshare -U true 2>/dev/null; then
  echo "UNEXPECTED: unshare -U succeeded"
  exit 1
fi
echo "OK: unshare -U blocked"

echo "=== io_uring_setup must be blocked ==="
if ! command -v cc >/dev/null 2>&1; then
  echo "SKIP: no C compiler available to exercise the raw syscall"
else
  # No $ or backticks below, so an unquoted heredoc delimiter is safe (no
  # accidental expansion by the shell that processes it).
  cat > /tmp/io_uring_check.c <<EOF
#include <sys/syscall.h>
#include <unistd.h>
#include <stdio.h>
#include <errno.h>
int main() {
  long ret = syscall(__NR_io_uring_setup, 1, NULL);
  if (ret == -1 && errno == EPERM) { printf("OK: io_uring_setup blocked\n"); return 0; }
  printf("UNEXPECTED: io_uring_setup returned %ld errno=%d\n", ret, errno);
  return 1;
}
EOF
  cc -O0 -o /tmp/io_uring_check /tmp/io_uring_check.c
  /tmp/io_uring_check
fi

echo "=== an ordinary syscall-heavy operation must still work (filter is not overly broad) ==="
echo hello | grep -q hello && echo "OK: basic pipeline works"
' \
  node run/dist/main.cjs
CODE=$?

echo ""
echo "=== Sandbox Seccomp Assertions ==="
echo ""
if [ "$CODE" = "0" ]; then
  echo "  PASS  seccomp filter blocks unshare -U / io_uring_setup while ordinary syscalls still work"
else
  echo "  FAIL  seccomp assertion check failed (exit $CODE)"
  exit 1
fi
echo ""
