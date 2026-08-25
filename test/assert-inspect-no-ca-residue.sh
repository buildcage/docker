#!/bin/bash
set -euo pipefail

# Regression guard for the inspect engine's per-RUN-step CA injection
# (docker/inspect/buildkit-runc/inject.go): the environment it sets lives only
# in the transient OCI process spec, never in what BuildKit commits, and the
# CA file(s) it writes to the rootfs are undone by its own restore() before
# the snapshot is taken. This checks both hold against the real image this
# test build produced, not just in theory.

IMAGE="${1:-buildcage-test}"
FAILURES=0

pass() { echo "  PASS  $1"; }
fail() {
  echo "  FAIL  $1"
  FAILURES=$((FAILURES + 1))
}

echo ""
echo "=== No CA Residue In The Built Image ($IMAGE) ==="
echo ""

# The standalone file NODE_EXTRA_CA_CERTS/DENO_CERT were pointed at, only
# created when the image had none of its own -- removed again once the step
# that needed it ends.
if docker run --rm "$IMAGE" sh -c 'test -e /etc/buildcage-ca.pem'; then
  fail "/etc/buildcage-ca.pem is present in the built image"
else
  pass "no standalone buildcage CA file in the built image"
fi

# The marked block appended to whichever system CA bundle the rootfs had
# (see castore.go's beginMarker/endMarker), removed by the same undo.
if docker run --rm "$IMAGE" sh -c '
  for f in /etc/ssl/certs/ca-certificates.crt /etc/pki/tls/certs/ca-bundle.crt \
           /etc/ssl/ca-bundle.pem /etc/pki/tls/cacert.pem /etc/ssl/cert.pem; do
    [ -f "$f" ] && grep -qF "# BEGIN buildcage CA" "$f" && exit 0
  done
  exit 1
'; then
  fail "the buildcage CA marker block is still appended to a system CA bundle"
else
  pass "no buildcage CA marker block in any system CA bundle"
fi

# Belt and suspenders: the CA-trust variables inject.go sets only ever reach
# the transient RUN-step process spec, never the image config BuildKit writes
# -- confirmed here against a real built image rather than just the claim.
LEAKED_ENV=$(docker inspect "$IMAGE" --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -E '^(NODE_EXTRA_CA_CERTS|DENO_CERT|REQUESTS_CA_BUNDLE|PIP_CERT|SSL_CERT_FILE)=' || true)
if [ -n "$LEAKED_ENV" ]; then
  fail "a buildcage CA-trust env var leaked into the image config: $LEAKED_ENV"
else
  pass "no buildcage CA-trust env var in the image config"
fi

echo ""
if [ "$FAILURES" -gt 0 ]; then
  echo "❌ FAILED: $FAILURES assertion(s) failed"
  exit 1
fi
echo "✅ All assertions passed."
echo ""
