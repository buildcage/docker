#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/helpers.sh"

# The build's own steps check Chromium trusted the proxy CA; this checks the
# committed image carries none of the bound database, and that a step writing
# to it fails the build.

IMAGE="${1:-buildcage-test}"
BUILDER="${BUILDER_NAME:-buildcage}"
PLATFORM="${TEST_PLATFORM:-linux/arm64}"

echo ""
echo "=== Chromium's NSS Database ($IMAGE) ==="
echo ""

if docker run --rm --user root "$IMAGE" sh -c '[ -d /root/.local/share/pki/nssdb ] && [ -z "$(ls -A /root/.local/share/pki/nssdb)" ]'; then
  pass "the image's own XDG database is still the empty directory the step made"
else
  fail "/root/.local/share/pki/nssdb is missing or holds something in the built image"
fi

for dir in /root/.pki /home/app/.pki /home/app/.local; do
  if docker run --rm --user root "$IMAGE" sh -c "test -e $dir"; then
    fail "$dir is in the built image"
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

if grep -q "changed the NSS database at /root/.pki/nssdb" <<<"$OUT"; then
  pass "the failure names the database the step wrote to"
else
  fail "the build log does not name /root/.pki/nssdb as changed"
fi

if grep -q "hint: .*fail_on_ca_residue: false" <<<"$OUT"; then
  pass "the failure points at fail_on_ca_residue"
else
  fail "the build log does not point at fail_on_ca_residue"
fi

assert_results
