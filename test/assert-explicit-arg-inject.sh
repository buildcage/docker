#!/bin/bash
set -euo pipefail

FAILURES=0
LOGS=$(docker compose exec builder cat /var/log/buildkitd/current 2>/dev/null)

echo ""
echo "=== Explicit Proxy Engine: Dockerfile ARG Auto-Injection Assertions ==="
echo ""

# test/Dockerfile.explicit-arg-inject's own RUN steps already fail the build
# (exit 1) if npm install fails, so simply having reached this script proves
# buildkit-proxy's injected NODE_USE_SYSTEM_CA=1 let npm trust BuildKit's
# --proxy-network MITM CA in both stages — no ARG was declared in the
# Dockerfile and none was passed on any RUN command line.
echo "[npm install] succeeded in both stages without any Dockerfile changes (the build would have failed otherwise): PASS"
echo ""

echo "[allowed] registry.npmjs.org must not be denied:"
if echo "$LOGS" | grep -F "denied by policy" | grep -qF "registry.npmjs.org"; then
  echo "  FAIL  found unexpected denial entries for registry.npmjs.org"
  FAILURES=$((FAILURES + 1))
else
  echo "  PASS  no denial entries for registry.npmjs.org"
fi
echo ""

echo "[image config] NODE_USE_SYSTEM_CA must not leak into the final image's ENV (ARG only takes effect during the build, never persisted):"
IMAGE_ENV=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' buildcage-test 2>/dev/null || true)
if echo "$IMAGE_ENV" | grep -qF "NODE_USE_SYSTEM_CA"; then
  echo "  FAIL  NODE_USE_SYSTEM_CA leaked into the final image's ENV:"
  echo "$IMAGE_ENV" | grep -F "NODE_USE_SYSTEM_CA"
  FAILURES=$((FAILURES + 1))
else
  echo "  PASS  NODE_USE_SYSTEM_CA is not present in the final image's ENV"
fi
echo ""

if [ "$FAILURES" -gt 0 ]; then
  echo "❌ FAILED: $FAILURES assertion(s) failed"
  exit 1
fi
echo "✅ All assertions passed."
echo ""
