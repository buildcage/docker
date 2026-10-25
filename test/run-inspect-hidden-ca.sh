#!/bin/bash
#
# A copy of the CA the layer sweep finds but cannot remove fails the build.
#
# Each such case must fail naming the file and pointing at fail_on_ca_residue.
# The control writes an unrelated encrypted keystore and must build. The
# resealed case must build with the CA taken out and the keystore still sealed
# under changeit. Then, with fail_on_ca_residue false, the same copy only warns.
set -euo pipefail

cd "$(dirname "$0")/.."

: "${COMPOSE_PROJECT_NAME:=buildcage-project}"
export COMPOSE_PROJECT_NAME
export BUILDCAGE_BUILD_TEST_HOOKS=1

# The Makefile exports all three (the first two carry the worktree suffix);
# these defaults are for running the script by hand.
BUILDER_NAME="${BUILDER_NAME:-buildcage}"
TEST_IMAGE="${TEST_IMAGE:-buildcage-test}"
TEST_PLATFORM="${TEST_PLATFORM:-linux/arm64}"
export BUILDER_NAME

export BUILDCAGE_TEST_COMPOSE_OVERLAY=docker/compose.action.test-inspect.yaml
LOG=$(mktemp -t buildcage-hidden-ca-XXXXXX.log)

start() {
  ./test/setup-builder.sh inspect audit
}

stop() {
  docker buildx rm "$BUILDER_NAME" >/dev/null 2>&1 || true
  docker compose -p "$COMPOSE_PROJECT_NAME" \
    -f docker/compose.action.yaml -f "$BUILDCAGE_TEST_COMPOSE_OVERLAY" down -v --rmi local
  docker rmi "$TEST_IMAGE" >/dev/null 2>&1 || true
}

build() {
  docker buildx build --no-cache --builder "$BUILDER_NAME" --platform "$TEST_PLATFORM" \
    --progress=plain --build-arg CASE="$1" -f test/Dockerfile.inspect-hidden-ca test/ "${@:2}"
}

fail_with_log() {
  tail -40 "$LOG"
  echo "FAIL: $1"
  exit 1
}

# A failure leaves no builder running and keeps the log of the build it read.
cleanup() {
  local status=$?
  stop || true
  if [ "$status" -eq 0 ]; then
    rm -f "$LOG"
  else
    echo "Build log kept at $LOG"
  fi
}
trap cleanup EXIT

start

for case in leaf json; do
  echo "=== A copy of the CA the sweep cannot take out: $case ==="
  if build "$case" >"$LOG" 2>&1; then
    echo "FAIL: the build committed a copy of the CA ($case)"
    exit 1
  fi
  grep -q "cannot strip: /app/" "$LOG" ||
    fail_with_log "the build failed, but not on the copy of the CA ($case)"
  grep -q "hint: .*fail_on_ca_residue: false" "$LOG" ||
    fail_with_log "the failure does not point at fail_on_ca_residue ($case)"
  echo "PASS: the build failed on the copy of the CA, pointing at fail_on_ca_residue ($case)"
done

echo "=== An encrypted keystore that is not the CA's ==="
build control
echo "PASS: the build kept a keystore that is not the CA's"

echo "=== A keystore under changeit the sweep takes the CA out of ==="
build resealed --load -t "$TEST_IMAGE"
listing=$(docker run --rm "$TEST_IMAGE" keytool -list -keystore /app/trust.p12 -storepass changeit) ||
  { echo "FAIL: the resealed keystore does not open under changeit"; exit 1; }
if echo "$listing" | grep -qi buildcage; then
  echo "FAIL: the resealed keystore still trusts the CA"
  exit 1
fi
roots=$(echo "$listing" | grep -c trustedCertEntry || true)
if [ "${roots:-0}" -lt 100 ]; then
  echo "FAIL: the resealed keystore kept only $roots roots"
  exit 1
fi
named=$(echo "$listing" | grep trustedCertEntry | grep -c ' \[jdk\],' || true)
if [ "$named" != "$roots" ]; then
  echo "FAIL: only $named of $roots roots kept their [jdk] alias"
  exit 1
fi
if docker run --rm "$TEST_IMAGE" keytool -list -keystore /app/trust.p12 -storepass not-the-password >/dev/null 2>&1; then
  echo "FAIL: the resealed keystore opens without changeit"
  exit 1
fi
echo "PASS: the sweep took the CA out, kept $roots roots under their aliases, and resealed under changeit"

stop

echo "=== fail_on_ca_residue: false, where the same copy only warns ==="
FAIL_ON_CA_RESIDUE=false start
build leaf >"$LOG" 2>&1 || fail_with_log "the copy of the CA failed the build"
grep -q "buildcage: warning: .*cannot strip: /app/" "$LOG" ||
  fail_with_log "no warning names the copy of the CA"
echo "PASS: the build carried on past the copy of the CA, warning about it"
