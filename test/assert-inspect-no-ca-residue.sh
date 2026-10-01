#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/helpers.sh"

# Regression guard for the inspect engine's per-RUN-step CA injection
# (docker/inspect/buildcage-runc/inject.go): the environment it sets lives only
# in the transient OCI process spec, never in what BuildKit commits, and the
# certificate is taken back out of the step's own layer, by reading that layer
# rather than a list of paths (layer.go), before the snapshot is taken. This
# checks that both hold against the real image this test build produced.

IMAGE="${1:-buildcage-test}"

echo ""
echo "=== No CA Residue In The Built Image ($IMAGE) ==="
echo ""

# The certificate appended to whichever system CA bundle the rootfs had,
# taken back out when the step ends. The CA is generated per build, so a copy
# of it anywhere in a bundle is one that was not taken back out.
BUILDER="${BUILDER_NAME:-buildcage}"
CA_LINE=$(docker exec "$BUILDER" cat /opt/buildcage/ca.pem 2>/dev/null \
  | awk '/-----BEGIN CERTIFICATE-----/{getline; print; exit}' || true)
if [ -z "$CA_LINE" ]; then
  fail "could not read the injected CA out of $BUILDER, so this cannot be checked"
# The anchor paths are checked alongside the bundles: the CA is written into
# each distribution's anchor directory too, and taken back out by the same
# layer sweep.
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

# An anchor directory the injection created goes with the anchor. Neither test
# fixture's base image ships /etc/pki at all, so anything left there is the
# injection's, empty directory included.
if docker run --rm "$IMAGE" sh -c 'test -d /etc/pki'; then
  fail "an anchor directory the injection created is still in the built image"
else
  pass "no anchor directory left in the built image"
fi

# The JVM's own keystore, built from the trust store while a JRE was installed
# (the Debian fixture). keytool is in the image because the JRE is, so the
# committed keystore is read back through it; a binary JKS holds the DER, not
# the base64 line the bundles are grepped for. The Alpine fixture ships no JRE
# and skips this.
#
# The listing is captured and its exit code checked, rather than piped into
# grep: the sweep rewrites and reseals the keystore, so "no buildcage" is only
# meaningful if keytool could still read it. A rewrite that corrupted the seal
# leaves keytool exiting non-zero with nothing on stdout, which a bare
# `keytool | grep -qi buildcage` would read as a pass. The kept-root floor
# catches the other end: a rewrite that dropped more than the one entry. Debian
# bookworm's ca-certificates seeds ~150 roots, so 100 is well clear of a
# healthy store and well above a gutted one.
if docker run --rm "$IMAGE" sh -c 'command -v keytool >/dev/null 2>&1 && test -f /etc/ssl/certs/java/cacerts'; then
  if listing=$(docker run --rm "$IMAGE" \
    keytool -list -keystore /etc/ssl/certs/java/cacerts -storepass changeit 2>/dev/null); then
    roots=$(grep -c trustedCertEntry <<<"$listing" || true)
    if grep -qi buildcage <<<"$listing"; then
      fail "the buildcage CA is still trusted in the JVM keystore"
    elif [ "${roots:-0}" -lt 100 ]; then
      fail "the sweep left the JVM keystore with only $roots roots; it dropped more than the CA"
    else
      pass "the JVM keystore is readable, keeps its $roots roots, and no longer trusts the CA"
    fi
  else
    fail "the JVM keystore is unreadable after the sweep; the rewrite corrupted it"
  fi
fi

# The base image's own JVM keystore: the case the keystore injection exists for
# (docker/inspect/buildcage-runc/jvmstore.go), as opposed to the
# ca-certificates-java one above. The cacerts path is discovered from the image's
# own JAVA_HOME (both the JDK 9+ lib/security and a JDK 8's jre/lib), which covers
# both shapes a JDK ships it in, PKCS#12 (eclipse-temurin:21) and JKS
# (eclipse-temurin:17). It is a second check on the common keystore; the layer
# sweep in buildcage-runc is what guarantees no keystore in any shape or location
# (jssecacerts, the RHEL paths) reaches the image carrying the CA, by failing the
# build if one does. The injection lands only in the scratch mirror bound over
# the step, so a committed keystore that still trusted the CA would mean the undo
# let the mirror through; the kept-root floor catches a rewrite that dropped more
# than the CA, the same way the ca-certificates-java check above does.
JVM_CACERTS=$(docker run --rm "$IMAGE" sh -c '
  for p in "$JAVA_HOME/lib/security/cacerts" "$JAVA_HOME/jre/lib/security/cacerts"; do
    [ -f "$p" ] && { printf %s "$p"; break; }
  done' 2>/dev/null || true)
if [ -n "$JVM_CACERTS" ]; then
  if listing=$(docker run --rm "$IMAGE" \
    keytool -list -keystore "$JVM_CACERTS" -storepass changeit 2>/dev/null); then
    roots=$(grep -c trustedCertEntry <<<"$listing" || true)
    if grep -qi buildcage <<<"$listing"; then
      fail "the buildcage CA is still trusted in the base image JVM keystore ($JVM_CACERTS)"
    elif [ "${roots:-0}" -lt 100 ]; then
      fail "the base image JVM keystore has only $roots roots; it dropped more than the CA"
    else
      pass "the base image JVM keystore is readable, keeps its $roots roots, and no longer trusts the CA"
    fi
  else
    fail "the base image JVM keystore is unreadable after the step; the undo corrupted it"
  fi
fi

# A copy of the store the step made outside it (see the fixture Dockerfiles).
# Nothing lists those paths, so they are reached only by reading the step's own
# layer back before BuildKit commits it. The Debian fixture also re-armours the
# certificate as a TRUSTED CERTIFICATE carrying trust settings, the shape a RHEL
# trust rebuild leaves behind, whose body matches neither the original block nor
# its whole base64. The pattern below still finds it, because base64 encodes in
# three-byte groups and the certificate comes first, so the two share this line.
#
# The store-copying fixtures fail the build if they cannot make these, so
# finding none there means the fixture has gone stale rather than that there is
# nothing to check. A fixture with no system CA store to copy (the Java base
# images) sets NO_APP_STORE_COPIES to say so, since for it an empty /app is
# expected rather than a stale fixture.
COPIES=$(docker run --rm "$IMAGE" sh -c 'ls /app/*.pem 2>/dev/null' || true)
if [ -z "$CA_LINE" ]; then
  : # already reported above; an empty pattern would match every file
elif [ -z "$COPIES" ] && [ -n "${NO_APP_STORE_COPIES:-}" ]; then
  pass "no store copies under /app to check, as this fixture makes none"
elif [ -z "$COPIES" ]; then
  fail "the fixture left no copy of the store under /app, so this cannot be checked"
elif docker run --rm -e CA_LINE="$CA_LINE" "$IMAGE" sh -c '
  for f in /app/*.pem; do
    grep -qF "$CA_LINE" "$f" && exit 0
  done
  exit 1
'; then
  fail "the buildcage CA is still present in a copy of the store: $(tr "\n" " " <<< "$COPIES")"
else
  pass "no buildcage CA in the step's own copies of the store: $(tr "\n" " " <<< "$COPIES")"
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
