#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/helpers.sh"

# The build's own steps check Chromium trusted the proxy CA; this checks the
# committed image carries none of what the wrapper added to the databases, that
# what the steps wrote to them is there, and that a step writing to a covered
# database fails the build.

IMAGE="${1:-buildcage-test}"
BUILDER="${BUILDER_NAME:-buildcage}"
PLATFORM="${TEST_PLATFORM:-linux/arm64}"

echo ""
echo "=== Chromium's NSS Database ($IMAGE) ==="
echo ""

for db in /root/.pki/nssdb /home/app/.local/share/pki/nssdb; do
  if docker run --rm --user root "$IMAGE" sh -c "certutil -L -d sql:$db -n own-ca >/dev/null"; then
    pass "$db still trusts the CA a step added to it"
  else
    fail "$db lost the CA a step added to it"
  fi
  if docker run --rm --user root "$IMAGE" sh -c "grep -q buildcage $db/pkcs11.txt"; then
    fail "$db/pkcs11.txt still names the proxy CA's slot"
  else
    pass "$db/pkcs11.txt no longer names the proxy CA's slot"
  fi
done

if docker run --rm --user root "$IMAGE" sh -c 'grep -q own-module /root/.pki/nssdb/pkcs11.txt'; then
  pass "the module a step added with modutil is still in /root/.pki/nssdb/pkcs11.txt"
else
  fail "the module a step added with modutil is gone from /root/.pki/nssdb/pkcs11.txt"
fi

for dir in /home/app/.pki /home/copier/.pki /tmp/home-copy/.pki/nssdb/pkcs11.txt /dev/buildcage-nssdb /tmp/control; do
  if docker run --rm --user root "$IMAGE" sh -c "test -e $dir"; then
    fail "$dir is in the built image"
  else
    pass "no $dir in the built image"
  fi
done

if docker run --rm --user root "$IMAGE" sh -c 'test -f /tmp/home-copy/.bashrc'; then
  pass "the copy of a home is in the built image"
else
  fail "the copy of a home is missing from the built image"
fi

if docker run --rm --user root "$IMAGE" sh -c '[ "$(ls -A /home/reader/.pki/nssdb)" = "$(printf "cert9.db\nkey4.db\npkcs11.txt")" ]'; then
  pass "the covered database is as the image left it"
else
  fail "the covered database changed in the built image"
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

if grep -q "changed the NSS database at /home/app/.pki/nssdb" <<<"$OUT"; then
  pass "the failure names the database the step wrote to"
else
  fail "the build log does not name /home/app/.pki/nssdb as changed"
fi

if grep -q "hint: .*fail_on_ca_residue: false" <<<"$OUT"; then
  pass "the failure points at fail_on_ca_residue"
else
  fail "the build log does not point at fail_on_ca_residue"
fi

assert_results
