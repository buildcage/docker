#!/bin/bash
# Drives two sandbox proxy lifecycles directly against sandbox/dist/main.cjs
# (rather than through two real `uses: ./sandbox` steps) so this test doesn't
# depend on GitHub Actions' `parallel:` step keyword to prove true
# concurrency — see test.yml's own `parallel:`-based test for the
# Actions-level version of the same check.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAILURES=0

TMP_A=$(mktemp -d)
TMP_B=$(mktemp -d)
cleanup() { rm -rf "$TMP_A" "$TMP_B"; }
trap cleanup EXIT

run_instance() {
  local tmpdir="$1" https_rule="$2" own_url="$3" other_url="$4"
  GITHUB_WORKSPACE="$tmpdir" \
  GITHUB_STATE="$tmpdir/state.env" \
  GITHUB_STEP_SUMMARY="$tmpdir/summary.md" \
  BUILDCAGE_SANDBOX_DEBUG_SUMMARY_FILE="$tmpdir/debug-summary.md" \
  BUILDCAGE_BUILD_TEST_HOOKS=1 \
  BUILDCAGE_LOCAL_IMAGE_REF="$BUILDCAGE_LOCAL_IMAGE_REF" \
  INPUT_ALLOWED_HTTPS_RULES="$https_rule" \
  INPUT_ALLOWED_HTTP_RULES="" \
  INPUT_ALLOWED_IP_RULES="" \
  INPUT_FAIL_ON_BLOCKED="false" \
  INPUT_RUN="wget -q -T 5 -O /dev/null $own_url
if wget -q -T 5 -O /dev/null $other_url 2>&1; then
  echo cross-talk: $other_url was reachable
  exit 1
fi" \
    node "$REPO_ROOT/sandbox/dist/main.cjs" > "$tmpdir/out.log" 2>&1
  echo $? > "$tmpdir/exit_code"
}

: "${BUILDCAGE_LOCAL_IMAGE_REF:?BUILDCAGE_LOCAL_IMAGE_REF must be set to the locally built sandbox image}"
touch "$TMP_A/state.env" "$TMP_B/state.env"

run_instance "$TMP_A" "example.com:443" "https://example.com/" "https://example.net/" &
PID_A=$!
run_instance "$TMP_B" "example.net:443" "https://example.net/" "https://example.com/" &
PID_B=$!

wait "$PID_A"
wait "$PID_B"

echo ""
echo "=== Sandbox Concurrent-Execution Assertions ==="
echo ""

for label_dir in "A:$TMP_A" "B:$TMP_B"; do
  label="${label_dir%%:*}"
  dir="${label_dir#*:}"
  code=$(cat "$dir/exit_code")
  if [ "$code" = "0" ]; then
    echo "  PASS  instance $label reached only its own allowlisted host"
  else
    echo "  FAIL  instance $label -- exit code $code, see log below"
    cat "$dir/out.log"
    FAILURES=$((FAILURES + 1))
  fi
done

LEFTOVER_CONTAINERS=$(docker ps -a --filter "name=buildcage-sandbox-" -q)
if [ -z "$LEFTOVER_CONTAINERS" ]; then
  echo "  PASS  no leftover buildcage-sandbox-* containers"
else
  echo "  FAIL  leftover buildcage-sandbox-* containers: $LEFTOVER_CONTAINERS"
  FAILURES=$((FAILURES + 1))
fi

LEFTOVER_NETWORKS=$(docker network ls --filter "name=buildcage-sandbox-" -q)
if [ -z "$LEFTOVER_NETWORKS" ]; then
  echo "  PASS  no leftover buildcage-sandbox-* networks"
else
  echo "  FAIL  leftover buildcage-sandbox-* networks: $LEFTOVER_NETWORKS"
  FAILURES=$((FAILURES + 1))
fi

echo ""
if [ "$FAILURES" -gt 0 ]; then
  echo "❌ FAILED: $FAILURES assertion(s) failed"
  exit 1
fi
echo "✅ All assertions passed."
echo ""
