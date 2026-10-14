#!/bin/bash
#
# The audit-then-restrict round trip, which is what the inspect engine is for.
#
# Phase 1 runs a build under `audit` and takes the `allowed_url_rules` the
# report generated from what it saw. Phase 2 restarts under `restrict` with
# exactly those rules and repeats every request plus a few the first build
# never made: rules that break the build they were learned from make the
# workflow useless, rules that permit everything make it pointless.
#
# Driven as one script rather than from the Makefile because the second
# phase's configuration is produced by the first.
set -euo pipefail

cd "$(dirname "$0")/.."

: "${COMPOSE_PROJECT_NAME:=buildcage-project}"
export COMPOSE_PROJECT_NAME
export BUILDCAGE_BUILD_TEST_HOOKS=1

# The Makefile exports all three (the first two carry WORKTREE_SUFFIX); these
# defaults are for running the script by hand.
BUILDER_NAME="${BUILDER_NAME:-buildcage}"
TEST_IMAGE="${TEST_IMAGE:-buildcage-test}"
TEST_PLATFORM="${TEST_PLATFORM:-linux/arm64}"
export BUILDER_NAME

BASE_COMPOSE="compose.yaml:compose.test-inspect.yaml"
OVERRIDE=$(mktemp -t buildcage-roundtrip-XXXXXX.yaml)
trap 'rm -f "$OVERRIDE"' EXIT

start() {
  local mode="$1" compose="$2"
  COMPOSE_FILE="$compose" PROXY_ENGINE=inspect PROXY_MODE="$mode" \
    docker compose -p "$COMPOSE_PROJECT_NAME" up -d --wait --build >/dev/null
  docker buildx rm "$BUILDER_NAME" >/dev/null 2>&1 || true
  docker buildx create --bootstrap --name "$BUILDER_NAME" \
    --driver remote "docker-container://$BUILDER_NAME" >/dev/null
}

build() {
  docker buildx build --no-cache --builder "$BUILDER_NAME" --platform "$TEST_PLATFORM" \
    --progress=plain -f "$1" test/ --load -t "$TEST_IMAGE"
}

echo ""
echo "=== Phase 1: check the audit run and learn the rules from it ==="
start audit "$BASE_COMPOSE"
build test/Dockerfile.inspect-audit

# The only build of Dockerfile.inspect-audit in the suite, so the audit-mode
# assertions run against it here rather than on a second build of their own.
./test/assert-inspect-audit.sh

RULES=$(
  COMPOSE_FILE="$BASE_COMPOSE" GITHUB_STEP_SUMMARY= node report/src/main.ts 2>&1 |
    # Stops at the next top-level key (allowed_tls_rules/allowed_ip_rules are
    # echoed into the same fenced block, see inspect-example.ts) as well as
    # the closing fence, so only the allowed_url_rules value is captured.
    awk '
      /allowed_url_rules: \|/ { capture=1; next }
      capture && /^ *(allowed_tls_rules|allowed_ip_rules): \|/ { exit }
      capture && /```/ { exit }
      capture { print }
    ' | sed 's/^ *//'
)

if [ -z "$RULES" ]; then
  echo "❌ FAILED: the audit report generated no allowed_url_rules"
  exit 1
fi

echo ""
echo "Rules generated from the audit run:"
sed 's/^/    /' <<< "$RULES"

# Written as a compose override so phase 2 is configured by nothing but this,
# with every host and TLS rule cleared: the URL rules have to stand alone.
{
  echo "services:"
  echo "  builder:"
  echo "    environment:"
  echo "      - ALLOWED_HTTPS_RULES="
  echo "      - ALLOWED_HTTP_RULES="
  echo "      - ALLOWED_TLS_RULES="
  # One YAML scalar with escaped newlines, since a URL rule contains a space.
  # awk rather than `sed -z`, which is GNU-only and silently yields nothing on
  # a BSD sed.
  printf '      - "ALLOWED_URL_RULES=%s"\n' \
    "$(awk 'NR>1{printf "\\n"} {printf "%s", $0}' <<< "$RULES")"
} > "$OVERRIDE"

echo ""
echo "=== Phase 2: enforce them, unedited ==="
start restrict "$BASE_COMPOSE:$OVERRIDE"
build test/Dockerfile.inspect-roundtrip

echo ""
echo "✅ The generated rules permit everything the audit run did, and block what it never did."
echo ""
