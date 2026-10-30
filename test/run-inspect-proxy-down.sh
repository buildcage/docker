#!/bin/bash
#
# A builder whose proxy stops mid-build: haproxy, then coredns, stopped while a
# RUN step is still running. The step's traffic must then fail instead of
# finding a way around the proxy, and the report must not pass a run the
# stopped proxy can no longer vouch for, nor one with only the resolver still
# stopped once haproxy is back.
#
# The step cannot reach the runner, and the runner cannot reach into the step
# except through the builder, so the two take turns through marker files in
# the step's /tmp: the step writes one when it is done with a phase, and this
# script, from inside the builder, finds the step's process by its command line
# and writes the next one through /proc/<pid>/root once a service is down (see
# test/proxy-down-step.sh for the phases).
set -uo pipefail
source "$(dirname "$0")/helpers.sh"

cd "$(dirname "$0")/.." || exit 1

: "${COMPOSE_PROJECT_NAME:=buildcage-project}"
export COMPOSE_PROJECT_NAME
export BUILDCAGE_BUILD_TEST_HOOKS=1

# The Makefile exports both (the first carries the worktree suffix); these
# defaults are for running the script by hand.
BUILDER_NAME="${BUILDER_NAME:-buildcage}"
TEST_PLATFORM="${TEST_PLATFORM:-linux/arm64}"
export BUILDER_NAME

export BUILDCAGE_TEST_COMPOSE_OVERLAY=docker/compose.action.test-inspect.yaml

SCRATCH=$(mktemp -d -t buildcage-proxy-down-XXXXXX)
BUILD_PID=""
cleanup() {
  [ -n "$BUILD_PID" ] && kill "$BUILD_PID" >/dev/null 2>&1
  rm -rf "$SCRATCH"
}
trap cleanup EXIT

echo ""
echo "=== Proxy stopped mid-build Assertions ==="
echo ""

if ! ./test/setup-builder.sh inspect restrict >/dev/null; then
  fail "the builder did not start"
  assert_results
fi

docker buildx build --no-cache --builder "$BUILDER_NAME" --platform "$TEST_PLATFORM" \
  --progress=plain -f test/Dockerfile.inspect-proxy-down test/ \
  >"$SCRATCH/build.log" 2>&1 &
BUILD_PID=$!

# Prints the pid of a process of the step once it has written /tmp/<marker>,
# looking for up to five minutes inside the builder, one exec per marker. The
# bracket keeps the pattern from matching this command's own command line.
step_pid_with() {
  # shellcheck disable=SC2016 # expanded inside the builder
  docker exec "$BUILDER_NAME" sh -c '
    for _ in $(seq 1 600); do
      for f in $(grep -lE "proxy-down-step[.]sh" /proc/[0-9]*/cmdline 2>/dev/null); do
        pid=${f#/proc/}
        pid=${pid%/cmdline}
        if [ -e "/proc/$pid/root/tmp/$1" ]; then
          echo "$pid"
          exit 0
        fi
      done
      sleep 0.5
    done
    exit 1' sh "$1" 2>/dev/null
}

# wait_for_step <marker>: sets STEP_PID once the step has written <marker>;
# false if the build ended first or the wait ran out.
wait_for_step() {
  step_pid_with "$1" >"$SCRATCH/step.pid" &
  local search=$!
  while kill -0 "$search" 2>/dev/null; do
    if ! kill -0 "$BUILD_PID" 2>/dev/null; then
      kill "$search" 2>/dev/null
      wait "$search"
      return 1
    fi
    sleep 0.5
  done
  wait "$search" || return 1
  STEP_PID=$(cat "$SCRATCH/step.pid")
}

# Brings the s6 service down for good, as a crash the supervisor was told not
# to recover from would.
stop_service() {
  local svc="$1"
  if docker exec "$BUILDER_NAME" s6-svc -wd -T 20000 -d "/run/service/$svc"; then
    pass "$svc stopped in the builder"
  else
    fail "could not stop $svc in the builder"
  fi
}

tell_step() {
  docker exec "$BUILDER_NAME" touch "/proc/$STEP_PID/root/tmp/$1" ||
    fail "could not write $1 into the step"
}

STEP_PID=""
gave_up=0
if wait_for_step serving.done; then
  stop_service haproxy
  tell_step haproxy.down
  if wait_for_step haproxy-phase.done; then
    stop_service coredns
    tell_step coredns.down
  else
    fail "the step never finished its haproxy phase"
    gave_up=1
  fi
else
  fail "the step never reached the proxy"
  gave_up=1
fi

# A step left waiting for a marker that will never come would sit out its own
# two-minute wait, so the build is stopped instead; either way it gets five
# minutes to end.
[ "$gave_up" = 0 ] || kill "$BUILD_PID" 2>/dev/null
for _ in $(seq 1 600); do
  kill -0 "$BUILD_PID" 2>/dev/null || break
  sleep 0.5
done
if kill -0 "$BUILD_PID" 2>/dev/null; then
  fail "the build did not end within five minutes"
  kill -9 "$BUILD_PID" 2>/dev/null
fi
wait "$BUILD_PID"
BUILD_EXIT=$?
BUILD_PID=""

echo ""
echo "--- the RUN step ---"
grep -E '(PASS|FAIL)  |=== ' "$SCRATCH/build.log" | sed 's/^/    /'
if [ "$BUILD_EXIT" = "0" ]; then
  pass "every request the step made after a service stopped failed"
else
  fail "the build failed (exit $BUILD_EXIT); its log follows"
  sed 's/^/    /' "$SCRATCH/build.log"
fi

echo ""
echo "--- the report ---"
# shellcheck disable=SC2034 # read by assert_logged
LOGS=$(builder_log haproxy)
assert_logged GET "http://allowed.example.com/public/pkg.tgz" 200
assert_logged GET "https://allowed.example.com/public/pkg.tgz" 200

# Written to a real file, not left unset: the report emits its annotation only
# when it has a summary to write.
SUMMARY="$SCRATCH/summary.md"
: >"$SUMMARY"
REPORT_EXIT=0
REPORT_OUTPUT=$(INPUT_FAIL_ON_BLOCKED=true GITHUB_STEP_SUMMARY="$SUMMARY" \
  node report/src/main.ts 2>&1) || REPORT_EXIT=$?

report_failed=0
if [ "$REPORT_EXIT" = "1" ]; then
  pass "the report failed the step (exit 1)"
else
  fail "the report exited $REPORT_EXIT, expected 1"
  report_failed=1
fi
if grep -q "^::error::buildcage proxy logs are incomplete" <<<"$REPORT_OUTPUT"; then
  pass "the report's error says the logs are incomplete"
else
  fail "the report's error does not say the logs are incomplete"
  report_failed=1
fi
if grep -qF "This report is incomplete" "$SUMMARY"; then
  pass "the report marks itself incomplete"
else
  fail "the report does not mark itself incomplete"
  report_failed=1
fi
if grep -qF "The proxy did not answer the report" <<<"$REPORT_OUTPUT"; then
  pass "the report's error says the proxy did not answer"
else
  fail "the report's error does not say the proxy did not answer"
  report_failed=1
fi
if [ "$report_failed" = "1" ]; then
  echo "$REPORT_OUTPUT" | sed 's/^/    /'
fi

# A stopped proxy is not a rule the build broke, so turning the step's failure
# off for blocks does not turn it off for this.
: >"$SUMMARY"
REPORT_EXIT=0
REPORT_OUTPUT=$(INPUT_FAIL_ON_BLOCKED=false GITHUB_STEP_SUMMARY="$SUMMARY" \
  node report/src/main.ts 2>&1) || REPORT_EXIT=$?
if [ "$REPORT_EXIT" = "1" ]; then
  pass "the report failed the step with fail-on-blocked: false too"
else
  fail "the report exited $REPORT_EXIT with fail-on-blocked: false, expected 1"
  echo "$REPORT_OUTPUT" | sed 's/^/    /'
fi

# start_service <service>: brings a stopped s6 service back and waits until it
# reports ready.
start_service() {
  local svc="$1"
  if docker exec "$BUILDER_NAME" s6-svc -wU -T 20000 -u "/run/service/$svc"; then
    pass "$svc started again in the builder"
  else
    fail "could not start $svc again in the builder"
  fi
}

echo ""
echo "--- the report with only coredns stopped ---"
# haproxy's restart alone fails no step with fail-on-blocked: false, so a
# failure here is the stopped resolver's.
start_service haproxy
: >"$SUMMARY"
REPORT_EXIT=0
REPORT_OUTPUT=$(INPUT_FAIL_ON_BLOCKED=false GITHUB_STEP_SUMMARY="$SUMMARY" \
  node report/src/main.ts 2>&1) || REPORT_EXIT=$?
report_failed=0
if [ "$REPORT_EXIT" = "1" ]; then
  pass "the report failed the step with fail-on-blocked: false"
else
  fail "the report exited $REPORT_EXIT with fail-on-blocked: false, expected 1"
  report_failed=1
fi
if grep -qF "The DNS resolver did not answer the report" <<<"$REPORT_OUTPUT"; then
  pass "the report's error says the resolver did not answer"
else
  fail "the report's error does not say the resolver did not answer"
  report_failed=1
fi
if [ "$report_failed" = "1" ]; then
  echo "$REPORT_OUTPUT" | sed 's/^/    /'
fi

echo ""
echo "--- the report with both running again ---"
# Shows it was the stopped resolver: with it back, the restart alone leaves a
# notice.
start_service coredns
: >"$SUMMARY"
REPORT_EXIT=0
REPORT_OUTPUT=$(INPUT_FAIL_ON_BLOCKED=false GITHUB_STEP_SUMMARY="$SUMMARY" \
  node report/src/main.ts 2>&1) || REPORT_EXIT=$?
if [ "$REPORT_EXIT" = "0" ] && ! grep -qF "did not answer the report" <<<"$REPORT_OUTPUT"; then
  pass "the report passed the step with both running again"
else
  fail "the report exited $REPORT_EXIT with both running again, expected 0 and no service down"
  echo "$REPORT_OUTPUT" | sed 's/^/    /'
fi

assert_results
