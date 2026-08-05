#!/bin/bash
# build-test-bundle.sh — dev-only stand-in for sandbox/oci-config.ts's
# buildOciConfig, used by `make test_sandbox_dev` to build just enough of
# an OCI bundle to exercise run-isolated.sh directly (see
# ../compose.sandbox-dev.yaml and ../dev/Dockerfile for why this dev loop
# doesn't run the real run/dist/main.cjs, and so needs a minimal
# hand-built substitute for the config.json JS would normally produce).
#
# Not a full reimplementation: no writable-path/writable-/ handling, no
# read env passthrough beyond PATH -- just enough to run the smoke test
# with the same namespaces/capabilities/seccomp policy production uses.
set -euo pipefail

NETNS_NAME=""
SCRIPT_PATH=""
BUNDLE_DIR=""

while [ $# -gt 0 ]; do
  case "$1" in
    --netns-name) NETNS_NAME="$2"; shift 2 ;;
    --script) SCRIPT_PATH="$2"; shift 2 ;;
    --bundle) BUNDLE_DIR="$2"; shift 2 ;;
    *) echo "ERROR: unknown argument: $1" >&2; exit 1 ;;
  esac
done
[ -z "$NETNS_NAME" ] && { echo "ERROR: --netns-name is required" >&2; exit 1; }
[ -z "$SCRIPT_PATH" ] && { echo "ERROR: --script is required" >&2; exit 1; }
[ -z "$BUNDLE_DIR" ] && { echo "ERROR: --bundle is required" >&2; exit 1; }

mkdir -p "$BUNDLE_DIR"
(cd "$BUNDLE_DIR" && runc spec)
gen-seccomp-profile > "$BUNDLE_DIR/seccomp.json"

printf 'nameserver 172.20.0.1\n' > "$BUNDLE_DIR/resolv.conf"

jq \
  --arg netnsPath "/var/run/netns/${NETNS_NAME}" \
  --arg rootfsBindDir "${BUNDLE_DIR}/rootfs" \
  --arg resolvConf "${BUNDLE_DIR}/resolv.conf" \
  --arg scriptPath "$SCRIPT_PATH" \
  --slurpfile seccomp "$BUNDLE_DIR/seccomp.json" \
  --slurpfile extraMasked /etc/buildcage/extra-masked-proc-paths.json \
  '
  .root.path = $rootfsBindDir | .root.readonly = true |
  .mounts += [
    {"destination":"/etc/resolv.conf","type":"none","source":$resolvConf,"options":["rbind","ro"]},
    {"destination":"/tmp","type":"none","source":"/tmp","options":["rbind","rw"]}
  ] |
  .linux.namespaces = (.linux.namespaces | map(if .type == "network" then . + {"path": $netnsPath} else . end)) |
  .linux.seccomp = $seccomp[0] |
  .linux.maskedPaths += $extraMasked[0] |
  .linux.readonlyPaths -= $extraMasked[0] |
  .process.terminal = false |
  .process.user = {"uid": 1000, "gid": 1000} |
  .process.args = ["setpriv", "--pdeathsig=KILL", "--", $scriptPath] |
  .process.capabilities = {"bounding":[],"effective":[],"permitted":[],"inheritable":[],"ambient":[]} |
  .process.noNewPrivileges = true
  ' "$BUNDLE_DIR/config.json" > "$BUNDLE_DIR/config.json.new"
mv "$BUNDLE_DIR/config.json.new" "$BUNDLE_DIR/config.json"
