#!/bin/bash
# run-isolated.sh — run a command in a network-isolated sandbox via runc.
#
# Creates a network namespace, wires a veth pair directly between it and the
# buildcage-proxy container's own netns (the proxy-side end is renamed to
# "sandbox0" and given the proxy's fixed gateway address -- no bridge
# involved, since this is always a 1:1 connection: one sandbox, one proxy),
# bind-mounts the host's own "/" so it can be handed to runc as a read-only
# rootfs, and execs `runc run` against an OCI bundle (config.json) that
# sandbox/oci-config.ts has already fully built -- namespaces, capabilities,
# mounts, uid/gid, and the seccomp filter are all declared there. This
# script only sets up what runc itself cannot: the network namespace's veth
# wiring into the proxy, and the rootfs bind-mount runc needs as its
# root.path (pivot_root can't target "/" itself).
#
# Must be run as root (invoked via `sudo -n` from the run action).
set -euo pipefail

# Re-exec into a fresh, private mount namespace before doing anything else.
# Every concurrently running `run:` step's own scratch dir lives under the
# same /tmp, so without this, the `mount --rbind /` staging below (and `ip
# netns add`'s own bind-mount of /run/netns) would run in the one mount
# namespace shared by every step on the host -- unavoidably nesting a copy
# of each concurrently running step's rootfs tree inside every other's
# snapshot, which races their unmount/rmdir cleanup against each other.
# With this, everything this script mounts is invisible to (and
# unaffected by) every other concurrent invocation from the moment it's
# created. `--propagation private` is `unshare`'s shortcut for "unshare +
# recursively make every mount private" in one step. No `--fork`, so this
# and the subsequent exec replace the current process in place -- this
# script's PID (and /proc/self/cmdline, matched by
# integration-test-die-with-parent.sh's pgrep) stays the same across the
# re-exec.
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

# Tracks whether a ::group:: block is currently open (see group_start/
# group_end below), so cleanup() can force it closed if this script exits
# mid-group (e.g. a failed `ip netns add`) -- otherwise every line printed
# afterwards (including the WARNING messages below) would stay nested inside
# an unclosed, collapsed group in the Actions UI.
IN_GROUP=0

group_start() {
  echo "::group::$1" >&2
  IN_GROUP=1
}

group_end() {
  echo "::endgroup::" >&2
  IN_GROUP=0
}

cleanup() {
  set +e
  [ "$IN_GROUP" = "1" ] && group_end
  # -f/--force also kills the container's process tree if it's still
  # running (e.g. this trap fired from INT/TERM mid-run), so it must run
  # before the network/mount resources below are torn out from under it.
  "$RUNC_PATH" delete -f "$CONTAINER_ID" >/dev/null 2>&1
  # Not silenced: a failed unmount here (e.g. EBUSY from a lingering
  # process) leaves ROOTFS_BIND_DIR -- a bind-mount of the entire host
  # filesystem -- still live, so it's worth surfacing even though
  # sandbox/scratch-dir.ts's withScratchDir has its own safety net before it
  # recursively deletes this directory.
  UMOUNT_ERR_FILE="/tmp/.buildcage-umount-err.$$"
  umount -R "$ROOTFS_BIND_DIR" >/dev/null 2>"$UMOUNT_ERR_FILE" || {
    echo "WARNING: failed to unmount ${ROOTFS_BIND_DIR}: $(cat "$UMOUNT_ERR_FILE" 2>/dev/null)" >&2
  }
  rm -f "$UMOUNT_ERR_FILE"
  # The proxy-side veth end (renamed to "sandbox0" below) lives in the
  # long-lived proxy container's netns, so it must be explicitly removed --
  # unlike the target-side end (torn down for free when the sandbox netns
  # below is deleted), a still-alive namespace doesn't lose its interfaces
  # just because its veth peer's namespace went away.
  nsenter --net="/proc/${PROXY_PID}/ns/net" -- ip link del sandbox0 >/dev/null 2>&1
  ip netns del "$NETNS_NAME" >/dev/null 2>&1
  exit "$CODE"
}
trap cleanup EXIT INT TERM

# Bind-mounted first, before any of the network setup below: it has no
# dependency on the netns/veth work that follows, and doing it first
# minimizes the gap between sandbox/mountinfo.ts's listHostMounts() snapshot
# (which config.json's readonlyPaths was computed from) and this rbind
# actually capturing the host's mount table.
group_start "buildcage: preparing sandbox"
echo "Bind-mounting host root for runc's rootfs..." >&2
mkdir -p "$ROOTFS_BIND_DIR"
mount --rbind / "$ROOTFS_BIND_DIR"
# No separate `mount --make-rprivate` needed here: the whole-namespace
# `--propagation private` set up above already makes every mount created
# under it private by default, including this one.

echo "Creating sandbox network namespace..." >&2
ip netns add "$NETNS_NAME"

echo "Creating veth pair ${VETH_T} <-> ${VETH_P}..." >&2
ip link add "$VETH_T" type veth peer name "$VETH_P"
ip link set "$VETH_T" netns "$NETNS_NAME"
ip link set "$VETH_P" netns "$PROXY_PID"

echo "Configuring sandbox namespace network..." >&2
ip netns exec "$NETNS_NAME" sh -c "
  set -e
  ip link set '${VETH_T}' name eth0
  ip addr add '${TARGET_IP}/24' dev eth0
  ip link set eth0 up
  ip link set lo up
  ip route add default via '${GATEWAY}'
"

echo "Configuring proxy-side veth as sandbox0..." >&2
# No bridge: this is always a 1:1 connection (one sandbox, one proxy), so
# the veth end is simply renamed to a fixed, predictable name and given the
# proxy's own gateway address directly -- init-iptables's "-i sandbox0"
# rule (added at container startup, before this device exists) matches
# against that name regardless of when the device actually appears.
nsenter --net="/proc/${PROXY_PID}/ns/net" -- sh -c "
  set -e
  ip link set '${VETH_P}' name sandbox0
  ip addr add '${GATEWAY}/24' dev sandbox0
  ip link set sandbox0 up
"

echo "Executing isolated command via runc..." >&2
group_end
set +e
# No nsenter wrapper needed here: config.json's linux.namespaces network
# entry already points at /var/run/netns/${NETNS_NAME}, so runc joins it
# itself as part of its own container setup.
#
# setpriv --pdeathsig here (targeting this script's own life) is the first
# half of a two-hop die-with-parent chain: `runc run`'s own process, not
# the container process it starts, is this script's direct child, so a
# guard on just the *sandboxed* process (config.json's process.args, see
# buildOciConfig) would only protect against `runc run` itself dying --
# without this outer hop, SIGKILL-ing this script would leave `runc run`
# (and the sandboxed process under it) as a still-alive orphan.
#
# Known residual gap: on distros with the common `Defaults use_pty`
# sudoers setting, `sudo -n` forks a separate monitor process ahead of
# this script -- killing *that* specific process in isolation wouldn't
# trigger this chain, since this script would merely become its orphan,
# still alive. Low-severity (an orphaned but still-fully-sandboxed
# process, not a security boundary issue -- see docs/security.md), and
# not addressed here.
setpriv --pdeathsig=KILL -- "$RUNC_PATH" run --bundle "$BUNDLE_DIR" "$CONTAINER_ID"
CODE=$?
set -e

echo "buildcage: command exited with code ${CODE}" >&2
