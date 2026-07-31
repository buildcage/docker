#!/bin/bash
# Verifies post.ts can still clean up ecapture's process and cgroup dir after
# a hard kill bypasses main.ts's own finally block, via the ecapture_pid /
# ecapture_cgroup_path GITHUB_STATE entries main.ts records.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${BUILDCAGE_LOCAL_IMAGE_REF:?BUILDCAGE_LOCAL_IMAGE_REF must be set to the locally built proxy image}"

WORKDIR=$(mktemp -d)
touch "$WORKDIR/state.env"

cleanup() {
  [ -n "${NODE_PID:-}" ] && kill -9 "$NODE_PID" >/dev/null 2>&1
  sudo -n pkill -9 -x ecapture >/dev/null 2>&1
  docker ps -aq --filter "name=buildcage-proxy-" | xargs -r docker rm -f >/dev/null 2>&1
  docker network ls --filter "name=buildcage-proxy-" -q | xargs -r docker network rm >/dev/null 2>&1
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

GITHUB_WORKSPACE="$WORKDIR" \
GITHUB_STATE="$WORKDIR/state.env" \
GITHUB_STEP_SUMMARY="$WORKDIR/summary.md" \
BUILDCAGE_BUILD_TEST_HOOKS=1 \
BUILDCAGE_LOCAL_IMAGE_REF="$BUILDCAGE_LOCAL_IMAGE_REF" \
INPUT_ALLOWED_HTTPS_RULES="example.com:443" \
INPUT_RUN='sleep 300' \
  node "$REPO_ROOT/run/dist/main.cjs" > "$WORKDIR/out.log" 2>&1 &
NODE_PID=$!

echo "waiting for ecapture_pid to be recorded in GITHUB_STATE..." >&2
FOUND=0
for _ in $(seq 1 60); do
  if grep -q "^ecapture_pid=" "$WORKDIR/state.env" 2>/dev/null; then
    FOUND=1
    break
  fi
  sleep 0.5
done
if [ "$FOUND" != "1" ]; then
  echo "  FAIL  ecapture_pid was never recorded; see log below"
  cat "$WORKDIR/out.log"
  exit 1
fi

ECAPTURE_CGROUP=$(grep "^ecapture_cgroup_path=" "$WORKDIR/state.env" | cut -d= -f2-)

# Bypasses main.ts's own finally block entirely, simulating the runner
# cancelling the step (or an OOM kill) mid-run.
kill -9 "$NODE_PID" >/dev/null 2>&1
wait "$NODE_PID" 2>/dev/null

if ! pgrep -x ecapture >/dev/null 2>&1; then
  echo "  FAIL  ecapture already exited on its own -- this test can't tell recovery apart from a no-op"
  exit 1
fi

# Simulate GitHub Actions exposing this step's own GITHUB_STATE entries to
# its post action as STATE_<name> environment variables.
STATE_ENV_ARGS=()
while IFS='=' read -r k v; do
  [ -n "$k" ] && STATE_ENV_ARGS+=("STATE_$k=$v")
done < "$WORKDIR/state.env"
env "${STATE_ENV_ARGS[@]}" node "$REPO_ROOT/run/dist/post.cjs" > "$WORKDIR/post-out.log" 2>&1

echo ""
echo "=== Ecapture Hard-Kill Recovery Assertions ==="
echo ""
FAILURES=0

if pgrep -x ecapture >/dev/null 2>&1; then
  echo "  FAIL  ecapture process still running after post.ts ran; see log below"
  cat "$WORKDIR/post-out.log"
  FAILURES=$((FAILURES + 1))
else
  echo "  PASS  ecapture process cleaned up by post.ts"
fi

if [ -n "$ECAPTURE_CGROUP" ] && [ -d "$ECAPTURE_CGROUP" ]; then
  echo "  FAIL  cgroup directory $ECAPTURE_CGROUP still exists after post.ts ran"
  FAILURES=$((FAILURES + 1))
else
  echo "  PASS  cgroup directory cleaned up (or never left behind)"
fi

echo ""
if [ "$FAILURES" -gt 0 ]; then
  echo "❌ FAILED: $FAILURES assertion(s) failed"
  exit 1
fi
echo "✅ All assertions passed."
echo ""
