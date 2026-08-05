#!/bin/bash
# Drives run/dist/main.cjs directly against a real proxy container/HAProxy
# log, proving the INPUT_KNOWN_BLOCKED_RULES -> report -> pass/fail wiring
# end-to-end (the matching logic itself is already unit-tested). See
# test-e2e.yml's test_sandbox_fail_on_blocked for the Actions-level version
# of the "all matched" case.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FAILURES=0

: "${BUILDCAGE_LOCAL_IMAGE_REF:?BUILDCAGE_LOCAL_IMAGE_REF must be set to the locally built proxy image}"

run_instance() {
  local tmpdir="$1" known_blocked_rules="$2"
  GITHUB_WORKSPACE="$tmpdir" \
  GITHUB_STATE="$tmpdir/state.env" \
  GITHUB_STEP_SUMMARY="$tmpdir/summary.md" \
  BUILDCAGE_BUILD_TEST_HOOKS=1 \
  BUILDCAGE_LOCAL_IMAGE_REF="$BUILDCAGE_LOCAL_IMAGE_REF" \
  INPUT_ALLOWED_HTTPS_RULES="example.com:443" \
  INPUT_ALLOWED_HTTP_RULES="example.com:80" \
  INPUT_ALLOWED_IP_RULES="" \
  INPUT_KNOWN_BLOCKED_RULES="$known_blocked_rules" \
  INPUT_FAIL_ON_BLOCKED="true" \
  INPUT_RUN="wget -q -T 5 -O /dev/null http://neverssl.com/ || true" \
    node "$REPO_ROOT/run/dist/main.cjs" > "$tmpdir/out.log" 2>&1
  echo $? > "$tmpdir/exit_code"
}

echo ""
echo "=== Sandbox known_blocked_rules Assertions ==="
echo ""

# Case 1: the only blocked connection matches known_blocked_rules -> the
# step must succeed despite fail_on_blocked defaulting to true.
TMP_MATCH=$(mktemp -d)
touch "$TMP_MATCH/state.env" "$TMP_MATCH/summary.md"
run_instance "$TMP_MATCH" "neverssl.com:80"
CODE_MATCH=$(cat "$TMP_MATCH/exit_code")
if [ "$CODE_MATCH" = "0" ]; then
  echo "  PASS  matching known_blocked_rules kept the step from failing"
else
  echo "  FAIL  matching known_blocked_rules did not prevent failure -- exit code $CODE_MATCH, see log below"
  cat "$TMP_MATCH/out.log"
  FAILURES=$((FAILURES + 1))
fi
rm -rf "$TMP_MATCH"

# Case 2: known_blocked_rules is set but doesn't match the blocked
# connection -> the step must still fail as normal (known_blocked_rules
# isn't a backdoor allowlist).
TMP_MISMATCH=$(mktemp -d)
touch "$TMP_MISMATCH/state.env" "$TMP_MISMATCH/summary.md"
run_instance "$TMP_MISMATCH" "some-other-domain.example.com:443"
CODE_MISMATCH=$(cat "$TMP_MISMATCH/exit_code")
if [ "$CODE_MISMATCH" != "0" ]; then
  echo "  PASS  a non-matching known_blocked_rules entry still failed the step"
else
  echo "  FAIL  the step unexpectedly succeeded despite no known_blocked_rules match -- see log below"
  cat "$TMP_MISMATCH/out.log"
  FAILURES=$((FAILURES + 1))
fi
rm -rf "$TMP_MISMATCH"

echo ""
if [ "$FAILURES" -gt 0 ]; then
  echo "❌ FAILED: $FAILURES assertion(s) failed"
  exit 1
fi
echo "✅ All assertions passed."
echo ""
