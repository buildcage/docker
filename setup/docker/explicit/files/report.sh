#!/bin/bash
# report.sh — generate the outbound-traffic report for the explicit proxy
# engine. Runs on the GitHub Actions runner (copied out of a
# Sigstore-verified image via `docker cp`, executed there — never
# staged/cached anywhere on the runner between invocations), not inside the
# container: reaches into the container purely via `docker exec`.
#
# Owns everything downstream of report.js's JSON — parsing it (via jq,
# assumed present on the runner), writing the Job Summary, printing logs,
# substituting the {{GITHUB_ACTION_REPOSITORY}}/{{GITHUB_ACTION_REF}}
# placeholders, and the fail_on_blocked exit decision. report/src/main.ts
# just runs this script and reproduces its exit code, so a report.js JSON
# shape change alone can never cause a version-skew failure there — both
# sides of the JSON contract always come from this same image.
#
# Usage: report.sh <container-id>
set -euo pipefail

container_id="$1"

json=$(docker exec "$container_id" qjs --std -m /opt/buildcage/scripts/report.js)

mode=$(jq -r '.mode' <<< "$json")
blocked=$(jq -r '.blocked // false' <<< "$json")
message=$(jq -r '.message // empty' <<< "$json")
step_summary=$(jq -r --arg repo "${GITHUB_ACTION_REPOSITORY:-}" --arg ref "${GITHUB_ACTION_REF:-}" '
  .stepSummary
  | gsub("\\{\\{GITHUB_ACTION_REPOSITORY\\}\\}"; $repo)
  | gsub("\\{\\{GITHUB_ACTION_REF\\}\\}"; $ref)
' <<< "$json")

jq -r '.logs[]?' <<< "$json"

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  printf '%s' "$step_summary" >> "$GITHUB_STEP_SUMMARY"
else
  printf '%s\n' "$step_summary"
fi

if [ "$mode" = "null" ]; then
  exit 0
fi

fail_on_blocked=$(echo "${INPUT_FAIL_ON_BLOCKED:-true}" | tr '[:upper:]' '[:lower:]')
should_fail=false
if [ "$mode" = "restrict" ] && [ "$blocked" = "true" ] && [ "$fail_on_blocked" = "true" ]; then
  should_fail=true
fi

if [ -n "$message" ] && [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  if [ "$should_fail" = "true" ]; then
    echo "::error::$message"
  else
    echo "::notice::$message"
  fi
fi

if [ "$should_fail" = "true" ]; then
  exit 1
fi
