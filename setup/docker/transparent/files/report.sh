#!/bin/bash
# report.sh — generate the outbound-traffic report for the transparent
# proxy engine. Runs on the GitHub Actions runner (copied out of a
# Sigstore-verified image via `docker cp`, executed there — never
# staged/cached anywhere on the runner between invocations), not inside the
# container: reaches into the container purely via `docker exec`, so the
# `report` action itself never needs to know this engine's log path or how
# to invoke the in-container report mechanism. report.js itself reads the
# HAProxy log file directly (it's baked into the same image, so it always
# knows the right path) rather than this script fetching and piping it in —
# that keeps this script to a single `docker exec` with nothing to fail
# independently of the report generation itself.
#
# Usage: report.sh <container-id>
#
# Prints report.js's JSON output verbatim to stdout — including its
# unsubstituted {{GITHUB_ACTION_REPOSITORY}}/{{GITHUB_ACTION_REF}}
# placeholders. Those are only known to the actual `report` action step's
# own runtime, not inside the container, so report/src/main.ts substitutes
# them in afterwards (scoped to just the stepSummary field, not blindly
# across this whole payload — see its own comment for why).
set -euo pipefail

container_id="$1"

docker exec "$container_id" qjs --std -m /opt/buildcage/scripts/report.js
