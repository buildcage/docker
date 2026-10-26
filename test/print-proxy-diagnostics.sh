#!/bin/bash
# What the proxy logged and reported, for a build that failed before an
# assertion script could print it: the cases inside the build print only their
# own PASS and FAIL lines.
set -uo pipefail
source "$(dirname "$0")/helpers.sh"

cd "$(dirname "$0")/.." || exit 1

LOGS=$(builder_log haproxy || true)
DNS_LOG=$(builder_log coredns || true)
REPORT_MARKDOWN=$(GITHUB_STEP_SUMMARY='' node report/src/main.ts 2>&1 || true)
show_diagnostics
