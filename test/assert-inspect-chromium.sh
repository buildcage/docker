#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/helpers.sh"

# Dockerfile.inspect-chromium's own RUN steps already fail the build unless
# Chromium trusted the proxy CA, so this checks what the build committed: the
# database the wrapper bound over each step's own never reached a layer, the
# directories it created to bind it were taken back, and the image's own
# database is what the image put there. Then a step that writes to the bound
# database must fail the build, naming it.

IMAGE="${1:-buildcage-test}"
BUILDER="${BUILDER_NAME:-buildcage}"
PLATFORM="${TEST_PLATFORM:-linux/arm64}"

echo ""
echo "=== Chromium's NSS Database ($IMAGE) ==="
echo ""

# The step made it, empty, and nothing else wrote to it.
if docker run --rm --user root "$IMAGE" sh -c '[ -d /root/.pki/nssdb ] && [ -z "$(ls -A /root/.pki/nssdb)" ]'; then
  pass "the image's own legacy database is still the empty directory the step made"
else
  fail "/root/.pki/nssdb is missing or holds something in the built image"
fi

# Neither home had an XDG data directory before the wrapper made one to bind
# the database over, so anything there is the wrapper's.
for dir in /root/.local /home/app/.local; do
  if docker run --rm --user root "$IMAGE" sh -c "test -e $dir"; then
    fail "$dir, created to bind the database over, is in the built image"
  else
    pass "no $dir in the built image"
  fi
done

if docker run --rm --user root "$IMAGE" sh -c 'test -e /tmp/control'; then
  fail "the control step's home is in the built image"
else
  pass "the control step left nothing behind"
fi

echo ""
echo "=== A Step Writing To The Database Fails The Build ==="
echo ""

set +e
OUT=$(docker buildx build --no-cache \
  --builder "$BUILDER" \
  --platform "$PLATFORM" \
  --progress=plain -f "$(dirname "$0")/Dockerfile.inspect-nssdb-write" "$(dirname "$0")" 2>&1)
CODE=$?
set -e
echo "$OUT" | tail -20

if [ "$CODE" -eq 0 ]; then
  fail "the build succeeded, so the write was dropped silently"
else
  pass "the build failed"
fi

if grep -q "changed the NSS database at /root/.local/share/pki/nssdb" <<<"$OUT"; then
  pass "the failure names the database the step wrote to"
else
  fail "the build log does not name /root/.local/share/pki/nssdb as changed"
fi

assert_results
