#!/bin/bash
# run-isolated.sh — run a command in a network-isolated sandbox.
#
# Creates a throwaway network/pid/mount/uts/ipc/cgroup namespace, wires a
# veth pair into the buildcage-sandbox proxy container's "sandbox0" bridge,
# strips all capabilities and privilege-escalation paths from the target
# process, and execs the given script inside it.
#
# Must be run as root (invoked via `sudo -n` from the sandbox action).
set -euo pipefail

PROXY_PID=""
TARGET_UID=""
TARGET_GID=""
GATEWAY="172.20.0.1"
DNS="172.20.0.1"
TARGET_IP="172.20.0.101"
WORKDIR=""
HOME_DIR=""
ENV_FILE=""
SCRIPT_PATH=""
WRITABLE_PATHS=()

usage() {
  cat >&2 <<'EOF'
Usage: run-isolated.sh --proxy-pid <PID> --uid <UID> --gid <GID>
         [--gateway <IP>] [--dns <IP>] [--target-ip <IP>]
         [--workdir <PATH>] [--home <PATH>] [--writable <PATH>]...
         [--env-file <PATH>] -- <script-path>
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --proxy-pid) PROXY_PID="$2"; shift 2 ;;
    --uid) TARGET_UID="$2"; shift 2 ;;
    --gid) TARGET_GID="$2"; shift 2 ;;
    --gateway) GATEWAY="$2"; shift 2 ;;
    --dns) DNS="$2"; shift 2 ;;
    --target-ip) TARGET_IP="$2"; shift 2 ;;
    --workdir) WORKDIR="$2"; shift 2 ;;
    --home) HOME_DIR="$2"; shift 2 ;;
    --writable) WRITABLE_PATHS+=("$2"); shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --) shift; SCRIPT_PATH="${1:-}"; shift || true; break ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

[ -z "$PROXY_PID" ] && { echo "ERROR: --proxy-pid is required" >&2; usage; exit 1; }
[ -z "$TARGET_UID" ] && { echo "ERROR: --uid is required" >&2; usage; exit 1; }
[ -z "$TARGET_GID" ] && { echo "ERROR: --gid is required" >&2; usage; exit 1; }
[ -z "$SCRIPT_PATH" ] && { echo "ERROR: script path is required after --" >&2; usage; exit 1; }

if [ "$(id -u)" != "0" ]; then
  echo "ERROR: run-isolated.sh must be run as root (via sudo)" >&2
  exit 1
fi
for cmd in unshare nsenter setpriv ip env; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "ERROR: required command not found: $cmd" >&2; exit 1; }
done
[ -e "/proc/${PROXY_PID}/ns/net" ] || { echo "ERROR: proxy netns not found for pid ${PROXY_PID}" >&2; exit 1; }
[ -x "$SCRIPT_PATH" ] || { echo "ERROR: script not found or not executable: ${SCRIPT_PATH}" >&2; exit 1; }

RAND_ID=$(od -An -tx1 -N4 /dev/urandom 2>/dev/null | tr -d ' \n')
[ -z "$RAND_ID" ] && RAND_ID=$(printf '%08x' "$$")
VETH_T="sbxt${RAND_ID}"
VETH_P="sbxp${RAND_ID}"

PLACEHOLDER_UNSHARE_PID=""
PLACEHOLDER_PID=""
CODE=1

cleanup() {
  set +e
  if [ -n "$PLACEHOLDER_PID" ]; then
    # The proxy-side veth lives in the long-lived proxy container's netns,
    # so it must be explicitly removed; the target-side end disappears
    # automatically when the placeholder namespace is torn down below.
    nsenter --net="/proc/${PROXY_PID}/ns/net" -- ip link del "$VETH_P" >/dev/null 2>&1
  fi
  # The placeholder ("sleep infinity") is pid 1 inside its own new pid
  # namespace, and pid 1 ignores signals with a default action of
  # terminate unless it installed a handler -- SIGTERM will not touch it.
  # SIGKILL cannot be caught or ignored, so it always tears the namespace
  # down.
  [ -n "$PLACEHOLDER_PID" ] && kill -9 "$PLACEHOLDER_PID" >/dev/null 2>&1
  [ -n "$PLACEHOLDER_UNSHARE_PID" ] && kill -9 "$PLACEHOLDER_UNSHARE_PID" >/dev/null 2>&1
  wait >/dev/null 2>&1
  exit "$CODE"
}
trap cleanup EXIT INT TERM

echo "run-isolated: creating placeholder namespace..." >&2
unshare --net --pid --mount --uts --ipc --cgroup --mount-proc --fork -- sh -c 'exec sleep infinity' &
PLACEHOLDER_UNSHARE_PID=$!

# unshare --pid does not move the calling (unshare) process itself into the
# new pid namespace -- only the first forked child does, and *that* child's
# host-visible PID is what nsenter needs. Discover it via procfs.
i=0
while [ "$i" -lt 200 ]; do
  CHILD=$(cat "/proc/${PLACEHOLDER_UNSHARE_PID}/task/${PLACEHOLDER_UNSHARE_PID}/children" 2>/dev/null | awk '{print $1}')
  if [ -n "$CHILD" ] && [ -e "/proc/${CHILD}/ns/net" ]; then
    PLACEHOLDER_PID="$CHILD"
    break
  fi
  i=$((i + 1))
  sleep 0.02
done
[ -z "$PLACEHOLDER_PID" ] && { echo "ERROR: timed out waiting for placeholder namespace" >&2; exit 1; }
echo "run-isolated: placeholder pid=${PLACEHOLDER_PID}" >&2

# The placeholder's mount namespace starts out as a clone of the host's, and
# a cloned mount keeps the same propagation type (typically "shared" under
# systemd) as its origin -- meaning every bind-mount/remount below would
# otherwise propagate straight back out to the host's real mount namespace.
# `--make-rprivate` (recursive) detaches the whole tree from that peer group
# before anything else touches it.
nsenter --mount="/proc/${PLACEHOLDER_PID}/ns/mnt" -- mount --make-rprivate /

echo "run-isolated: creating veth pair ${VETH_T} <-> ${VETH_P}..." >&2
ip link add "$VETH_T" type veth peer name "$VETH_P"
ip link set "$VETH_T" netns "$PLACEHOLDER_PID"
ip link set "$VETH_P" netns "$PROXY_PID"

echo "run-isolated: configuring target namespace network..." >&2
nsenter --net="/proc/${PLACEHOLDER_PID}/ns/net" -- sh -c "
  set -e
  ip link set '${VETH_T}' name eth0
  ip addr add '${TARGET_IP}/24' dev eth0
  ip link set eth0 up
  ip link set lo up
  ip route add default via '${GATEWAY}'
"

echo "run-isolated: rewriting resolv.conf inside target mount namespace..." >&2
nsenter --mount="/proc/${PLACEHOLDER_PID}/ns/mnt" --net="/proc/${PLACEHOLDER_PID}/ns/net" -- sh -c "
  set -e
  printf 'nameserver %s\n' '${DNS}' > /tmp/.buildcage-resolv.conf
  mount --bind /tmp/.buildcage-resolv.conf /etc/resolv.conf
"

echo "run-isolated: masking sensitive /proc paths..." >&2
nsenter --mount="/proc/${PLACEHOLDER_PID}/ns/mnt" -- sh -c '
  for p in /proc/kcore /proc/kallsyms /proc/kmsg /proc/sysrq-trigger /proc/timer_list /proc/keys; do
    [ -e "$p" ] && mount --bind /dev/null "$p" 2>/dev/null
  done
  true
'

# Paths that stay writable: workdir/home/tmp plus whatever --writable added.
# "/" among the extras is a sentinel meaning "disable this restriction
# entirely" (see usage()) rather than literally protecting just the "/"
# mount entry, since most of the filesystem below "/" isn't a separate
# mount point and so wouldn't be covered by protecting "/" alone.
PROTECTED_PATHS=("$WORKDIR" "$HOME_DIR" /tmp)
[ ${#WRITABLE_PATHS[@]} -gt 0 ] && PROTECTED_PATHS+=("${WRITABLE_PATHS[@]}")
DISABLE_READONLY=false
for p in "${WRITABLE_PATHS[@]}"; do
  [ "$p" = "/" ] && DISABLE_READONLY=true
done

if [ "$DISABLE_READONLY" = "true" ]; then
  echo "run-isolated: 'writable: /' given -- leaving the filesystem fully writable" >&2
else
  echo "run-isolated: restricting filesystem to read-only (except workdir/home/tmp/writable)..." >&2
  # --target (not just --mount=) is required here: /proc/self/mountinfo only
  # resolves "self" correctly when this process is actually a member of the
  # pid namespace that the target's /proc instance was mounted for.
  nsenter --target "$PLACEHOLDER_PID" --mount --pid -- sh -c '
    set -e
    # Bind-mounting a path onto itself gives it its own mount-table entry, so
    # remounting everything else read-only below does not affect it.
    for d in "$@"; do
      [ -n "$d" ] && [ -d "$d" ] && mount --bind "$d" "$d"
    done
    # Walk existing mounts and remount each read-only in place, skipping the
    # paths just made writable above. "bind" is required: a plain
    # "remount,ro" changes the underlying superblock, which is shared with
    # the mount this was cloned from (i.e. the real host mount namespace)
    # even after make-rprivate -- only "remount,bind,ro" scopes the
    # read-only flag to this one mount entry. Best-effort per mount (some
    # pseudo-filesystems do not support remount) rather than fatal.
    tac /proc/self/mountinfo | while read -r _ _ _ _ mnt_point _; do
      skip=0
      for p in "$@"; do
        [ "$mnt_point" = "$p" ] && skip=1 && break
      done
      [ "$skip" = 1 ] && continue
      mount -o remount,bind,ro "$mnt_point" 2>/dev/null || true
    done
  ' sh "${PROTECTED_PATHS[@]}"
fi

echo "run-isolated: attaching proxy-side veth to sandbox0 bridge..." >&2
nsenter --net="/proc/${PROXY_PID}/ns/net" -- sh -c "
  set -e
  ip link set '${VETH_P}' master sandbox0
  ip link set '${VETH_P}' up
"

echo "run-isolated: executing isolated command..." >&2
set +e
NSENTER_ARGS=(--target "$PLACEHOLDER_PID" --net --mount --uts --ipc --cgroup --pid)
[ -n "$WORKDIR" ] && NSENTER_ARGS+=(--wd="$WORKDIR")

if [ -n "$ENV_FILE" ]; then
  # Read the NUL-separated KEY=VALUE dump directly into an array rather than
  # piping it through `xargs -0`: GNU xargs maps *any* exit status 1-125 from
  # the command it runs to its own fixed exit status 123 (255 becomes 124),
  # which would make it impossible for this script to report the isolated
  # command's actual exit code.
  # No "--" before setpriv: env treats the first non-NAME=VALUE token as
  # the command to run on its own.
  mapfile -d '' -t ENV_ASSIGNMENTS < "$ENV_FILE"
  nsenter "${NSENTER_ARGS[@]}" -- \
    env -i "${ENV_ASSIGNMENTS[@]}" \
    setpriv --reuid="$TARGET_UID" --regid="$TARGET_GID" --clear-groups \
      --bounding-set=-all --no-new-privs -- \
    "$SCRIPT_PATH"
  CODE=$?
else
  nsenter "${NSENTER_ARGS[@]}" -- \
    setpriv --reuid="$TARGET_UID" --regid="$TARGET_GID" --clear-groups \
      --bounding-set=-all --no-new-privs -- \
    "$SCRIPT_PATH"
  CODE=$?
fi
set -e

echo "run-isolated: command exited with code ${CODE}" >&2
