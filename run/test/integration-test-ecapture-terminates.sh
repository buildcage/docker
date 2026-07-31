#!/bin/bash
# Verifies ecapture (see isolated-exec.ts's startEcapture/stopEcapture) doesn't
# leak as an orphaned root process after the `run:` step finishes, and that it
# actually captured the request. Needs a real passwordless-sudo host, so this
# can't be a unit test.
set -uo pipefail

: "${BUILDCAGE_LOCAL_IMAGE_REF:?BUILDCAGE_LOCAL_IMAGE_REF must be set to the locally built proxy image}"

WORKDIR=$(mktemp -d)
touch "$WORKDIR/state.env"
trap 'rm -rf "$WORKDIR"' EXIT

GITHUB_WORKSPACE="$WORKDIR" \
GITHUB_STATE="$WORKDIR/state.env" \
GITHUB_STEP_SUMMARY="$WORKDIR/summary.md" \
BUILDCAGE_BUILD_TEST_HOOKS=1 \
BUILDCAGE_LOCAL_IMAGE_REF="$BUILDCAGE_LOCAL_IMAGE_REF" \
INPUT_ALLOWED_HTTPS_RULES="example.com:443" \
INPUT_RUN="wget -q -T 5 -O /dev/null https://example.com/" \
  node run/dist/main.cjs > "$WORKDIR/out.log" 2>&1
CODE=$?

echo ""
echo "=== Ecapture Termination Assertions ==="
echo ""

if [ "$CODE" != "0" ]; then
  echo "  FAIL  run/dist/main.cjs exited non-zero ($CODE); see log below"
  cat "$WORKDIR/out.log"
  exit 1
fi

FAILURES=0

if pgrep -x ecapture >/dev/null 2>&1; then
  echo "  FAIL  ecapture process still running after the step finished"
  pgrep -a -x ecapture
  FAILURES=$((FAILURES + 1))
else
  echo "  PASS  no ecapture process left running after the step finished"
fi

# Confirms the feature works end to end: wget -> ecapture -> ecapture-log-parser.ts -> report.
if grep -q '💬 HTTPS communication logs' "$WORKDIR/summary.md" 2>/dev/null && \
   grep -qE '^\s*- GET https://example\.com/ -> 200\s*$' "$WORKDIR/summary.md" 2>/dev/null; then
  echo "  PASS  GITHUB_STEP_SUMMARY records the GET https://example.com/ request"
else
  echo "  FAIL  GITHUB_STEP_SUMMARY is missing the expected HTTPS communication logs entry"
  cat "$WORKDIR/summary.md" 2>/dev/null
  FAILURES=$((FAILURES + 1))
fi

# Normal-path cleanup (removeCgroupDirIfEmpty); the hard-kill fallback path is
# covered separately by integration-test-ecapture-hard-kill-recovery.sh.
ECAPTURE_CGROUP=$(grep '^ecapture_cgroup_path=' "$WORKDIR/state.env" 2>/dev/null | cut -d= -f2-)
if [ -z "$ECAPTURE_CGROUP" ]; then
  echo "  FAIL  ecapture_cgroup_path was never recorded in GITHUB_STATE"
  FAILURES=$((FAILURES + 1))
elif [ -d "$ECAPTURE_CGROUP" ]; then
  echo "  FAIL  cgroup directory $ECAPTURE_CGROUP still exists after the step finished"
  FAILURES=$((FAILURES + 1))
else
  echo "  PASS  cgroup directory cleaned up after the step finished"
fi

echo ""
if [ "$FAILURES" -gt 0 ]; then
  echo "❌ FAILED: $FAILURES assertion(s) failed"
  exit 1
fi
echo "✅ All assertions passed."
echo ""
