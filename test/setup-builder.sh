#!/bin/bash
# setup-builder.sh <engine> <mode>: builds the builder image from this checkout
# and starts it through the setup action's own entry point, as a workflow's
# setup step would, with that image in place of the published one. The rest of
# the action's inputs come from the uppercase variables the README names
# (ALLOWED_HTTPS_RULES for allowed-https-rules, and so on).
#
# With BUILDCAGE_TEST_COMPOSE_OVERLAY naming a docker/compose.action.test-*.yaml,
# the builder also joins that file's fixtures and takes the rules
# fixture-rules-<engine>.sh sets.
set -euo pipefail
source "$(dirname "$0")/helpers.sh"

cd "$(dirname "$0")/.."

engine=$1 mode=$2

# The Makefile exports these, each carrying the worktree suffix; the defaults
# are for running the script by hand.
: "${BUILDER_NAME:=buildcage}"
: "${COMPOSE_PROJECT_NAME:=buildcage-project}"
export COMPOSE_PROJECT_NAME
export BUILDCAGE_BUILD_TEST_HOOKS=1

# fixture_rule <var>: sets <var> from stdin unless the caller already set it.
fixture_rule() {
  local rules
  rules=$(cat)
  [ -n "${!1+set}" ] || export "$1=$rules"
}

build_args=()
if [ -n "${BUILDCAGE_TEST_COMPOSE_OVERLAY:-}" ]; then
  # shellcheck source=/dev/null
  source "test/fixture-rules-$engine.sh"
  # The extra-CA hook the inspect fixtures need is compiled in only on request.
  if [ "$engine" = inspect ]; then build_args=(--build-arg BUILDCAGE_TEST_HOOKS=1); fi
  BUILDCAGE_TEST_COMPOSE_OVERLAY=$(cd "$(dirname "$BUILDCAGE_TEST_COMPOSE_OVERLAY")" && pwd)/$(basename "$BUILDCAGE_TEST_COMPOSE_OVERLAY")
  export BUILDCAGE_TEST_COMPOSE_OVERLAY
fi

echo "Starting buildcage ($engine engine, $mode mode)..."
image=$(PROXY_ENGINE="$engine" docker compose -f compose.yaml config --images builder)
build_builder_image "$engine" "$image" ${build_args[@]+"${build_args[@]}"}
# The action starts the fixtures with --no-build, under the project named here.
if [ -n "${BUILDCAGE_TEST_COMPOSE_OVERLAY:-}" ]; then
  docker compose -p "$COMPOSE_PROJECT_NAME" \
    -f docker/compose.action.yaml -f "$BUILDCAGE_TEST_COMPOSE_OVERLAY" build
fi

# GITHUB_OUTPUT and GITHUB_STATE belong to whatever step runs this script, so
# the setup step writes to throwaway files: left unset, it would fall back to
# the deprecated ::set-output:: command.
step_files=$(mktemp -d)
trap 'rm -rf "$step_files"' EXIT
: > "$step_files/output"
: > "$step_files/state"
GITHUB_OUTPUT="$step_files/output" GITHUB_STATE="$step_files/state" \
  BUILDCAGE_LOCAL_IMAGE_REF="$image" \
  INPUT_BUILDER_NAME="$BUILDER_NAME" \
  INPUT_PROXY_ENGINE="$engine" \
  INPUT_PROXY_MODE="$mode" \
  INPUT_ALLOWED_HTTPS_RULES="${ALLOWED_HTTPS_RULES:-}" \
  INPUT_ALLOWED_HTTP_RULES="${ALLOWED_HTTP_RULES:-}" \
  INPUT_ALLOWED_IP_RULES="${ALLOWED_IP_RULES:-}" \
  INPUT_ALLOWED_URL_RULES="${ALLOWED_URL_RULES:-}" \
  INPUT_ALLOWED_TLS_RULES="${ALLOWED_TLS_RULES:-}" \
  INPUT_KNOWN_BLOCKED_RULES="${KNOWN_BLOCKED_RULES:-}" \
  INPUT_FAIL_ON_CA_RESIDUE="${FAIL_ON_CA_RESIDUE:-}" \
  node src/main.ts

docker buildx rm "$BUILDER_NAME" >/dev/null 2>&1 || true
echo "Creating buildx builder..."
docker buildx create --bootstrap --name "$BUILDER_NAME" \
  --driver remote "docker-container://$BUILDER_NAME"
