#!/bin/bash
# Verifies that a client-supplied static SourcePolicy is merged with
# buildcage's own policy rather than rejected, and that the merge cannot be
# used to escalate access beyond what buildcage's own allowed_https_rules
# permit — buildcage's own rules are always placed last in the merged
# document, so its own DENY-all-then-ALLOW-listed-domains block always has
# the final say for every http(s) source (see solve.go's mergePolicy doc
# comment).
#
# docker/build-push-action doesn't expose a source-policy input directly, but
# `docker buildx build` (the CLI it wraps) reads the
# EXPERIMENTAL_BUILDKIT_SOURCE_POLICY env var and sets it as the request's
# static SourcePolicy field unconditionally — confirmed in docker/buildx's
# commands/build.go, which calls build.ReadSourcePolicy() regardless of any
# other flag. This lets the real client tool exercise the merge path
# directly, instead of reaching into the container via buildctl.
#
# Relies on the same running explicit-mode test environment as
# assert-explicit-mode.sh (allowed.example.com/blocked.example.com resolving
# via test-dns-explicit, per compose.test-explicit.yaml's ALLOWED_HTTPS_RULES).
set -euo pipefail

BUILDER_NAME="${BUILDER_NAME:-buildcage-explicit}"
FAILURES=0

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

echo ""
echo "=== Source Policy Merge Assertions ==="
echo ""

echo "[no escalation] a client ALLOW for a domain buildcage denies must still be blocked:"
cat > "$WORKDIR/policy-escalate.json" <<'EOF'
{"rules":[{"action":"ALLOW","selector":{"identifier":"^https://blocked\\.example\\.com(/.*)?$","matchType":"REGEX"}}]}
EOF
printf 'FROM alpine:3.20\nRUN wget -q -O /dev/null --timeout=5 https://blocked.example.com/\n' > "$WORKDIR/Dockerfile"
if EXPERIMENTAL_BUILDKIT_SOURCE_POLICY="$WORKDIR/policy-escalate.json" \
  docker buildx build --builder "$BUILDER_NAME" --progress=plain \
  -f "$WORKDIR/Dockerfile" "$WORKDIR" >"$WORKDIR/escalate-build.log" 2>&1; then
  echo "  FAIL  build unexpectedly succeeded — client's ALLOW escalated access beyond buildcage's own policy:"
  sed 's/^/    /' "$WORKDIR/escalate-build.log"
  FAILURES=$((FAILURES + 1))
# The build must fail because the RUN step's wget was blocked, not for an
# unrelated infrastructure reason (e.g. a builder-name mismatch) — otherwise
# this assertion would trivially "pass" no matter why the build failed.
elif ! grep -qE "RUN wget|executor failed running" "$WORKDIR/escalate-build.log"; then
  echo "  FAIL  build failed for an unrelated reason (not the RUN step):"
  sed 's/^/    /' "$WORKDIR/escalate-build.log"
  FAILURES=$((FAILURES + 1))
else
  echo "  PASS  build failed as expected (buildcage's own DENY still wins)"
fi
echo ""

echo "[no rejection] a build with a client-supplied policy must not be refused outright:"
printf 'FROM alpine:3.20\nRUN echo hi\n' > "$WORKDIR/Dockerfile"
if EXPERIMENTAL_BUILDKIT_SOURCE_POLICY="$WORKDIR/policy-escalate.json" \
  docker buildx build --builder "$BUILDER_NAME" --progress=plain \
  -f "$WORKDIR/Dockerfile" "$WORKDIR" >"$WORKDIR/ok-build.log" 2>&1; then
  echo "  PASS  build succeeded (no longer hard-rejected merely for having a client SourcePolicy)"
else
  echo "  FAIL  build unexpectedly failed:"
  sed 's/^/    /' "$WORKDIR/ok-build.log"
  FAILURES=$((FAILURES + 1))
fi
echo ""

echo "[legitimate access preserved] a client ALLOW for a domain buildcage also allows must still work:"
cat > "$WORKDIR/policy-redundant.json" <<'EOF'
{"rules":[{"action":"ALLOW","selector":{"identifier":"^https://allowed\\.example\\.com(/.*)?$","matchType":"REGEX"}}]}
EOF
printf 'FROM alpine:3.20\nRUN wget -q -O /dev/null --timeout=10 https://allowed.example.com/\n' > "$WORKDIR/Dockerfile"
if EXPERIMENTAL_BUILDKIT_SOURCE_POLICY="$WORKDIR/policy-redundant.json" \
  docker buildx build --builder "$BUILDER_NAME" --progress=plain \
  -f "$WORKDIR/Dockerfile" "$WORKDIR" >"$WORKDIR/allowed-build.log" 2>&1; then
  echo "  PASS  build succeeded"
else
  echo "  FAIL  build unexpectedly failed:"
  sed 's/^/    /' "$WORKDIR/allowed-build.log"
  FAILURES=$((FAILURES + 1))
fi
echo ""

if [ "$FAILURES" -gt 0 ]; then
  echo "❌ FAILED: $FAILURES assertion(s) failed"
  exit 1
fi
echo "✅ All assertions passed."
echo ""
