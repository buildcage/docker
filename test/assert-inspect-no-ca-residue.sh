#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/helpers.sh"

# Regression guard for the inspect engine's per-RUN-step CA injection
# (docker/inspect/buildcage-runc/inject.go): the environment it sets lives only
# in the transient OCI process spec, never in what BuildKit commits, and the
# CA file(s) it writes to the rootfs are undone by its own restore() before
# the snapshot is taken. This checks that both hold against the real image
# this test build produced.

IMAGE="${1:-buildcage-test}"

echo ""
echo "=== No CA Residue In The Built Image ($IMAGE) ==="
echo ""

# The standalone file NODE_EXTRA_CA_CERTS/DENO_CERT were pointed at, only
# created when the image had none of its own, removed again once the step
# that needed it ends.
if docker run --rm "$IMAGE" sh -c 'test -e /etc/buildcage-ca.pem'; then
  fail "/etc/buildcage-ca.pem is present in the built image"
else
  pass "no standalone buildcage CA file in the built image"
fi

# The certificate appended to whichever system CA bundle the rootfs had,
# removed by the same undo. The CA is generated per build, so a copy of it
# anywhere in a bundle is one the undo failed to take back out.
BUILDER="${BUILDER_NAME:-buildcage}"
CA_LINE=$(docker exec "$BUILDER" cat /opt/buildcage/ca.pem 2>/dev/null \
  | awk '/-----BEGIN CERTIFICATE-----/{getline; print; exit}' || true)
if [ -z "$CA_LINE" ]; then
  fail "could not read the injected CA out of $BUILDER, so this cannot be checked"
elif docker run --rm -e CA_LINE="$CA_LINE" "$IMAGE" sh -c '
  for f in /etc/ssl/certs/ca-certificates.crt /etc/pki/tls/certs/ca-bundle.crt \
           /etc/ssl/ca-bundle.pem /etc/pki/tls/cacert.pem /etc/ssl/cert.pem \
           /usr/local/share/ca-certificates/buildcage.crt \
           /etc/pki/ca-trust/source/anchors/buildcage.crt \
           /etc/pki/trust/anchors/buildcage.crt; do
    [ -f "$f" ] && grep -qF "$CA_LINE" "$f" && exit 0
  done
  exit 1
'; then
  fail "the buildcage CA is still present in a CA bundle or anchor directory"
else
  pass "no buildcage CA in any CA bundle or anchor directory"
fi

# The anchor directories are created when the image has none, and go again with
# whatever was written for them. Neither test fixture's base image ships
# /etc/pki at all, so anything left there is the injection's.
if docker run --rm "$IMAGE" sh -c 'test -d /etc/pki'; then
  fail "an anchor directory the injection created is still in the built image"
else
  pass "no anchor directory left in the built image"
fi

# The CA-trust variables inject.go sets only ever reach the transient RUN-step
# process spec, never the image config BuildKit writes. Confirmed here against
# a real built image.
LEAKED_ENV=$(docker inspect "$IMAGE" --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -E '^(NODE_EXTRA_CA_CERTS|DENO_CERT|REQUESTS_CA_BUNDLE|PIP_CERT|SSL_CERT_FILE)=' || true)
if [ -n "$LEAKED_ENV" ]; then
  fail "a buildcage CA-trust env var leaked into the image config: $LEAKED_ENV"
else
  pass "no buildcage CA-trust env var in the image config"
fi

assert_results
