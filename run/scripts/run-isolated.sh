#!/bin/bash
# run-isolated.sh — run a command in a network-isolated sandbox via runc.
#
# Creates a network namespace, wires a veth pair into the buildcage-proxy
# container's "sandbox0" bridge, bind-mounts the host's own "/" so it can
# be handed to runc as a read-only rootfs, and execs `runc run` against an
# OCI bundle (config.json) that isolated-exec.js has already fully built --
# namespaces, capabilities, mounts, uid/gid, and the seccomp filter are all
# declared there. This script only sets up what runc itself cannot: the
# network namespace's veth wiring into the proxy's bridge, and the rootfs
# bind-mount runc needs as its root.path (pivot_root can't target "/"
# itself).
#
# Must be run as root (invoked via `sudo -n` from the run action).
set -euo pipefail

# Re-exec into a fresh, private mount namespace before doing anything else.
# Without this, the mount --rbind / staging below (and `ip netns add`'s own
# bind-mount of /run/netns) operate directly in the one mount namespace
# shared by every concurrently running `run:` step on this host. Since
# each step's own rootfsBindDir lives under the same /tmp, each step's
# `mount --rbind /` snapshot unavoidably captures a nested copy of every
# *other* concurrently running step's own rootfs tree too -- whatever
# happens to exist under "/" at that instant. That doesn't break sandbox
# isolation itself (runc still creates its own further-nested namespace
# for the sandboxed process regardless), but it does mean concurrent
# steps' cleanup (unmount + rmdir) can race against each other's staging;
# empirically, this was the root cause of an intermittent EBUSY failure in
# isolated-exec.js's withScratchDir cleanup under concurrent `run:` steps.
# Doing the rest of this script's work in its own private mount namespace
# instead means its rootfs bind-mount and netns file are invisible to (and
# unaffected by) every other concurrent invocation from the moment they're
# created, the same staging pattern tools like bubblewrap use. `--propagation
# private` is `unshare`'s shortcut for "unshare + recursively make every
# mount private" in one step. No `--fork` is used, so this and the
# subsequent exec replace the current process in place rather than
# spawning a child -- this script's PID (and therefore its
# /proc/self/cmdline, matched by
# run/test/integration-test-die-with-parent.sh's pgrep) stays the same
# across the re-exec.
if [ -z "${BUILDCAGE_UNSHARED:-}" ]; then
  command -v unshare >/dev/null 2>&1 || { echo "ERROR: required command not found: unshare" >&2; exit 1; }
  export BUILDCAGE_UNSHARED=1
  exec unshare --mount --propagation private -- "$0" "$@"
fi

PROXY_PID=""
RUNC_PATH=""
BUNDLE_DIR=""
CONTAINER_ID=""
NETNS_NAME=""
ROOTFS_BIND_DIR=""
GATEWAY=""
DNS=""
TARGET_IP=""

usage() {
  cat >&2 <<'EOF'
Usage: run-isolated.sh --proxy-pid <PID> --runc <PATH> --bundle <DIR>
         --container-id <ID> --netns-name <NAME> --rootfs-bind-dir <DIR>
         --gateway <IP> --dns <IP> --target-ip <IP>
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --proxy-pid) PROXY_PID="$2"; shift 2 ;;
    --runc) RUNC_PATH="$2"; shift 2 ;;
    --bundle) BUNDLE_DIR="$2"; shift 2 ;;
    --container-id) CONTAINER_ID="$2"; shift 2 ;;
    --netns-name) NETNS_NAME="$2"; shift 2 ;;
    --rootfs-bind-dir) ROOTFS_BIND_DIR="$2"; shift 2 ;;
    --gateway) GATEWAY="$2"; shift 2 ;;
    --dns) DNS="$2"; shift 2 ;;
    --target-ip) TARGET_IP="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

[ -z "$PROXY_PID" ] && { echo "ERROR: --proxy-pid is required" >&2; usage; exit 1; }
[ -z "$RUNC_PATH" ] && { echo "ERROR: --runc is required" >&2; usage; exit 1; }
[ -z "$BUNDLE_DIR" ] && { echo "ERROR: --bundle is required" >&2; usage; exit 1; }
[ -z "$CONTAINER_ID" ] && { echo "ERROR: --container-id is required" >&2; usage; exit 1; }
[ -z "$NETNS_NAME" ] && { echo "ERROR: --netns-name is required" >&2; usage; exit 1; }
[ -z "$ROOTFS_BIND_DIR" ] && { echo "ERROR: --rootfs-bind-dir is required" >&2; usage; exit 1; }
[ -z "$GATEWAY" ] && { echo "ERROR: --gateway is required" >&2; usage; exit 1; }
[ -z "$DNS" ] && { echo "ERROR: --dns is required" >&2; usage; exit 1; }
[ -z "$TARGET_IP" ] && { echo "ERROR: --target-ip is required" >&2; usage; exit 1; }

if [ "$(id -u)" != "0" ]; then
  echo "ERROR: run-isolated.sh must be run as root (via sudo)" >&2
  exit 1
fi
for cmd in nsenter ip mount setpriv; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "ERROR: required command not found: $cmd" >&2; exit 1; }
done
[ -e "/proc/${PROXY_PID}/ns/net" ] || { echo "ERROR: proxy netns not found for pid ${PROXY_PID}" >&2; exit 1; }
[ -x "$RUNC_PATH" ] || { echo "ERROR: runc not found or not executable: ${RUNC_PATH}" >&2; exit 1; }
[ -f "${BUNDLE_DIR}/config.json" ] || { echo "ERROR: OCI bundle config not found: ${BUNDLE_DIR}/config.json" >&2; exit 1; }

RAND_ID=$(od -An -tx1 -N4 /dev/urandom 2>/dev/null | tr -d ' \n')
[ -z "$RAND_ID" ] && RAND_ID=$(printf '%08x' "$$")
VETH_T="sbxt${RAND_ID}"
VETH_P="sbxp${RAND_ID}"

CODE=1

cleanup() {
  set +e
  # -f/--force also kills the container's process tree if it's still
  # running (e.g. this trap fired from INT/TERM mid-run), so it must run
  # before the network/mount resources below are torn out from under it.
  "$RUNC_PATH" delete -f "$CONTAINER_ID" >/dev/null 2>&1
  # Not silenced: a failed unmount here (e.g. EBUSY from a lingering
  # process) leaves ROOTFS_BIND_DIR -- a bind-mount of the entire host
  # filesystem -- still live. isolated-exec.js's withScratchDir has its own
  # lazy-unmount safety net before it recursively deletes this directory,
  # but that's defense-in-depth, not a reason to hide this happening.
  UMOUNT_ERR_FILE="/tmp/.buildcage-umount-err.$$"
  umount -R "$ROOTFS_BIND_DIR" >/dev/null 2>"$UMOUNT_ERR_FILE" || {
    echo "WARNING: failed to unmount ${ROOTFS_BIND_DIR}: $(cat "$UMOUNT_ERR_FILE" 2>/dev/null)" >&2
  }
  rm -f "$UMOUNT_ERR_FILE"
  # The proxy-side veth lives in the long-lived proxy container's netns, so
  # it must be explicitly removed -- unlike the target-side end (torn down
  # for free when the sandbox netns below is deleted), a still-alive
  # namespace doesn't lose its interfaces just because its veth peer's
  # namespace went away.
  nsenter --net="/proc/${PROXY_PID}/ns/net" -- ip link del "$VETH_P" >/dev/null 2>&1
  ip netns del "$NETNS_NAME" >/dev/null 2>&1
  exit "$CODE"
}
trap cleanup EXIT INT TERM

echo "run-isolated: creating sandbox network namespace..." >&2
ip netns add "$NETNS_NAME"

echo "run-isolated: creating veth pair ${VETH_T} <-> ${VETH_P}..." >&2
ip link add "$VETH_T" type veth peer name "$VETH_P"
ip link set "$VETH_T" netns "$NETNS_NAME"
ip link set "$VETH_P" netns "$PROXY_PID"

echo "run-isolated: configuring sandbox namespace network..." >&2
ip netns exec "$NETNS_NAME" sh -c "
  set -e
  ip link set '${VETH_T}' name eth0
  ip addr add '${TARGET_IP}/24' dev eth0
  ip link set eth0 up
  ip link set lo up
  ip route add default via '${GATEWAY}'
"

echo "run-isolated: bind-mounting host root for runc's rootfs..." >&2
mkdir -p "$ROOTFS_BIND_DIR"
mount --rbind / "$ROOTFS_BIND_DIR"
# No separate `mount --make-rprivate` needed here: the whole-namespace
# `--propagation private` set up above already makes every mount created
# under it private by default, including this one.

echo "run-isolated: attaching proxy-side veth to sandbox0 bridge..." >&2
nsenter --net="/proc/${PROXY_PID}/ns/net" -- sh -c "
  set -e
  ip link set '${VETH_P}' master sandbox0
  ip link set '${VETH_P}' up
"

echo "run-isolated: executing isolated command via runc..." >&2
set +e
# No nsenter wrapper needed here: config.json's linux.namespaces network
# entry already points at /var/run/netns/${NETNS_NAME} (see
# isolated-exec.js's buildOciConfig), so runc joins it itself as part of
# its own container setup -- namespaces, capabilities, mounts, uid/gid,
# and the seccomp filter are all declared in config.json.
#
# setpriv --pdeathsig here (targeting this script's own life) is the first
# half of a two-hop chain: `runc run`'s own process, not the container
# process it starts, is this script's direct child, so a plain
# --die-with-parent-style guard on the *sandboxed* process alone (set in
# config.json's process.args, see buildOciConfig) would only protect
# against `runc run` itself dying -- if this script gets SIGKILL'd,
# `runc run` would just become an orphan (still alive, unaffected) without
# this. Verified empirically: killing this script's own bash process tears
# down the whole chain (runc and the sandboxed command both die); without
# the outer setpriv, the sandboxed command survives as an orphan.
#
# Known residual gap: `sudo -n` itself (invoked by isolated-exec.js) forks
# a separate monitor process ahead of this script on distros with the
# common `Defaults use_pty` sudoers setting -- if *that* specific process
# were killed in isolation (without this script also dying), this chain
# wouldn't trigger, since this script would merely become sudo's monitor's
# orphan, still alive. Not addressed here: this is a low-severity gap
# (an orphaned, still-fully-sandboxed process, not a security boundary
# issue -- see docs/security.md), and the realistic failure modes this
# guards against (the runner process/job being torn down, an OOM kill
# landing on this script itself) target this script directly, not
# specifically sudo's monitor process in isolation.
setpriv --pdeathsig=KILL -- "$RUNC_PATH" run --bundle "$BUNDLE_DIR" "$CONTAINER_ID"
CODE=$?
set -e

echo "run-isolated: command exited with code ${CODE}" >&2
