#!/bin/bash
#
# known_blocked_rules -> the setup step -> the builder container's environment
# -> the report's exit code.
#
# The matching itself is unit-tested (blocked-outcome.test.ts). What this
# covers is the rest: a rule set through the setup step decides whether
# fail_on_blocked fails the step, and one that matches nothing does not excuse
# the rest.
#
# Two phases over the same two-host build, because the rules are read from the
# container's own environment and each phase therefore needs its own builder:
# naming both blocked hosts must let the step pass, naming one of them must not.
set -euo pipefail
source "$(dirname "$0")/helpers.sh"

cd "$(dirname "$0")/.."

: "${COMPOSE_PROJECT_NAME:=buildcage-project}"
export COMPOSE_PROJECT_NAME
export BUILDCAGE_BUILD_TEST_HOOKS=1

# The Makefile exports all three (the first two carry WORKTREE_SUFFIX); these
# defaults are for running the script by hand.
BUILDER_NAME="${BUILDER_NAME:-buildcage}"
TEST_IMAGE="${TEST_IMAGE:-buildcage-test}"
TEST_PLATFORM="${TEST_PLATFORM:-linux/arm64}"
export BUILDER_NAME

export BUILDCAGE_TEST_COMPOSE_OVERLAY=docker/compose.action.test-universal.yaml
# One rule per line: known_blocked_rules is newline-separated.
BOTH_HOSTS="blocked.example.com:443
deep.sub.wildcard.example.com:443"
ONE_HOST="blocked.example.com:443"

REPORT_EXIT=0
REPORT_OUTPUT=""

# Written to a real file, not left unset: the report emits its annotation,
# the message each phase is judged on, only when it has a summary to write.
SUMMARY=$(mktemp -t buildcage-known-blocked-XXXXXX.md)
trap 'rm -f "$SUMMARY"' EXIT

run_phase() {
  local rules="$1"
  KNOWN_BLOCKED_RULES="$rules" ./test/setup-builder.sh universal restrict >/dev/null
  docker buildx build --no-cache --builder "$BUILDER_NAME" --platform "$TEST_PLATFORM" \
    --progress=plain -f test/Dockerfile.universal-known-blocked test/ --load -t "$TEST_IMAGE"

  : > "$SUMMARY"
  REPORT_EXIT=0
  REPORT_OUTPUT=$(INPUT_FAIL_ON_BLOCKED=true GITHUB_STEP_SUMMARY="$SUMMARY" \
    node report/src/main.ts 2>&1) || REPORT_EXIT=$?
}

report_output() {
  echo "$REPORT_OUTPUT" | sed 's/^/    /'
}

assert_exit() {
  local label="$1" expected="$2"
  if [ "$REPORT_EXIT" = "$expected" ]; then
    pass "$label (exit $REPORT_EXIT)"
  else
    fail "$label -- exit $REPORT_EXIT, expected $expected:"
    report_output
  fi
}

assert_message() {
  local text="$1"
  if grep -qF "$text" <<< "$REPORT_OUTPUT"; then
    pass "the annotation says \"$text\""
  else
    fail "the annotation does not say \"$text\":"
    report_output
  fi
}

echo ""
echo "=== known_blocked_rules Assertions ==="
echo ""

echo "=== Phase 1: every blocked host is named ==="
run_phase "$BOTH_HOSTS"
echo ""
echo "[all matched] fail_on_blocked must not fail the step:"
assert_exit "the report accepted the run" 0
assert_message "all matched known_blocked_rules (expected)"
echo ""

echo "=== Phase 2: one of the two blocked hosts is named ==="
run_phase "$ONE_HOST"
echo ""
echo "[one unmatched] known_blocked_rules must not excuse the rest:"
assert_exit "the report failed the step" 1
assert_message "1 of 2 distinct blocked host(s) unmatched by known_blocked_rules"

assert_results
