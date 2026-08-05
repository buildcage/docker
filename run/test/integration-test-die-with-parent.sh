#!/bin/bash
# Verifies the setpriv --pdeathsig chain (see run-isolated.sh and
# isolated-exec.ts's buildOciConfig): SIGKILL-ing run-isolated.sh's own
# process must tear down the whole sandboxed process tree rather than
# leaving it running as an orphan. Drives run/dist/main.cjs directly, not
# through the real action wrapper, so this script can reach in and kill
# run-isolated.sh mid-run.
set -uo pipefail

: "${BUILDCAGE_LOCAL_IMAGE_REF:?BUILDCAGE_LOCAL_IMAGE_REF must be set to the locally built proxy image}"

WORKDIR=$(mktemp -d)
touch "$WORKDIR/state.env" "$WORKDIR/summary.md"
FAILURES=0

cleanup() {
  [ -n "${NODE_PID:-}" ] && kill -9 "$NODE_PID" >/dev/null 2>&1
  # sudo itself (setuid root) and everything under it run as root, so
  # this needs the same privilege too.
  sudo -n pkill -9 -f "sudo -n -- .*/run/scripts/run-isolated.sh" >/dev/null 2>&1
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
INPUT_RUN='echo sandboxed-process-started; sleep 300' \
  node run/dist/main.cjs > "$WORKDIR/out.log" 2>&1 &
NODE_PID=$!

echo "waiting for the sandboxed 'sleep 300' to start..." >&2
FOUND=0
for _ in $(seq 1 60); do
  if pgrep -f "sleep 300" >/dev/null 2>&1; then
    FOUND=1
    break
  fi
  sleep 0.5
done
if [ "$FOUND" != "1" ]; then
  echo "  FAIL  sandboxed process never started; see log below"
  cat "$WORKDIR/out.log"
  exit 1
fi
sleep 0.5

# Sudo's `use_pty` setting (common on Ubuntu) forks a monitor process ahead
# of the actual script, which also matches "run-isolated.sh" in its argv --
# this must target the real bash instance, not sudo's monitor (see
# run-isolated.sh's own comment on this same distinction).
mapfile -t BASH_PIDS < <(pgrep -f "/bin/bash .*/run/scripts/run-isolated.sh")
if [ "${#BASH_PIDS[@]}" != "1" ]; then
  echo "  FAIL  expected exactly 1 run-isolated.sh bash process, found ${#BASH_PIDS[@]}: ${BASH_PIDS[*]:-<none>}"
  exit 1
fi
BASH_PID="${BASH_PIDS[0]}"

# run-isolated.sh runs as root (via sudo -n), so killing it requires the
# same privilege.
sudo -n kill -9 "$BASH_PID"
sleep 2

echo ""
echo "=== Sandbox die-with-parent Assertions ==="
echo ""
if pgrep -f "sleep 300" >/dev/null 2>&1; then
  echo "  FAIL  sandboxed process survived as an orphan after run-isolated.sh was killed"
  FAILURES=$((FAILURES + 1))
else
  echo "  PASS  entire sandbox process tree died with run-isolated.sh"
fi

echo ""
if [ "$FAILURES" -gt 0 ]; then
  echo "❌ FAILED: $FAILURES assertion(s) failed"
  exit 1
fi
echo "✅ All assertions passed."
echo ""
