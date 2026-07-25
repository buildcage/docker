#!/bin/bash
# report.sh — generate the outbound-traffic report for the explicit proxy
# engine. Runs on the GitHub Actions runner (copied out of a
# Sigstore-verified image via `docker cp`, executed there — never
# staged/cached anywhere on the runner between invocations), not inside the
# container: reaches into the container purely via `docker exec`, so the
# `report` action itself never needs to know this engine's log path or how
# to invoke the in-container report mechanism. buildctl itself is invoked by
# report.js, inside the container — not from here — since only buildctl's
# build-history API (not this log file) can attribute allowed requests to a
# specific RUN step.
#
# Usage: report.sh <container-id>
#   Reads GITHUB_ACTION_REPOSITORY/GITHUB_ACTION_REF from its own
#   environment (inherited from the report action's process) to substitute
#   into the {{...}} placeholders report.js's step summary leaves behind —
#   those two values only exist in the report action step's own runtime,
#   not inside the container.
#
# Prints the final JSON report to stdout.
set -euo pipefail

container_id="$1"

raw_log=$(docker exec "$container_id" sh -c 'cat /var/log/buildkitd/current 2>/dev/null || true')

json=$(printf '%s' "$raw_log" | docker exec -i "$container_id" qjs --std -m /opt/buildcage/scripts/report.js)

printf '%s' "$json" | sed \
  -e "s|{{GITHUB_ACTION_REPOSITORY}}|${GITHUB_ACTION_REPOSITORY:-}|g" \
  -e "s|{{GITHUB_ACTION_REF}}|${GITHUB_ACTION_REF:-}|g"
