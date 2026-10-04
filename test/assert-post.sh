#!/bin/bash
# Verifies src/post.ts (run by the caller beforehand) removed the builder
# container: post.ts's own down only knows docker/compose.action.yaml's
# "builder" service. BUILDKIT_VOLUME is the container's /var/lib/buildkit
# volume, read before post.ts ran.
set -euo pipefail
source "$(dirname "$0")/helpers.sh"

BUILDER_NAME="${BUILDER_NAME:-buildcage}"

echo ""
echo "[setup post] verifying post.ts actually removed the builder container:"
if docker inspect "$BUILDER_NAME" >/dev/null 2>&1; then
  fail "$BUILDER_NAME still exists after post.ts cleanup"
else
  pass "$BUILDER_NAME removed by post.ts"
fi
if [ -z "${BUILDKIT_VOLUME:-}" ]; then
  fail "no /var/lib/buildkit volume was recorded before post.ts ran"
elif docker volume inspect "$BUILDKIT_VOLUME" >/dev/null 2>&1; then
  fail "the /var/lib/buildkit volume $BUILDKIT_VOLUME still exists after post.ts cleanup"
else
  pass "the /var/lib/buildkit volume removed by post.ts"
fi

assert_results
