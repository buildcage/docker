#!/bin/bash
# HAProxy binds *:10024 (both engines' CoreDNS also binds *:53), but only
# buildcage0, the CNI bridge BuildKit wires up once a build starts, may reach
# them (see docker/common/files/s6-scripts/init-iptables). This starts each
# engine's builder on its own, with no build running, so buildcage0 never
# exists: :10024/:53 must be unreachable both from another container on the
# builder's own compose network and from the runner host itself.
#
# The same standalone builder also has to reach its own readiness checks over
# loopback and exit on SIGTERM, which is what tells an over-broad rule from a
# correct one that merely looks unreachable from outside. The host-side probes
# only mean something where the bridge is routable from the host, i.e. Linux;
# CI is the final word on them.
set -euo pipefail
source "$(dirname "$0")/helpers.sh"

cd "$(dirname "$0")/.."

# Both engines run in audit mode so that CoreDNS answers every name (it refuses
# an unlisted name only in restrict mode, see coredns-config.ts).
# An answer then proves the port was reachable rather than that a rule matched.
# The INPUT rules under test are the same in either mode.
dns_answered() {
  local network="$1" target="$2"
  docker run --rm --network "$network" "$TEST_ALPINE_IMAGE" sh -c \
    "apk add --no-cache -q bind-tools >/dev/null 2>&1 && dig +time=2 +tries=1 @$target example.com A" 2>/dev/null \
    | grep -qE '^example\.com\.[[:space:]]'
}

run_engine() {
  local engine="$1"
  # Both are global to the daemon, so they carry the Makefile's worktree suffix.
  local project="buildcage-listener-scope-$engine${BUILDCAGE_WORKTREE_SUFFIX:-}"
  local builder="buildcage-listener-scope${BUILDCAGE_WORKTREE_SUFFIX:-}"
  local compose=(docker compose -p "$project" -f compose.yaml)

  echo ""
  echo "=== Listener Scope Assertions ($engine) ==="
  echo ""

  cleanup() {
    BUILDER_NAME="$builder" "${compose[@]}" down -v --rmi local >/dev/null 2>&1 || true
  }
  trap cleanup RETURN

  BUILDER_NAME="$builder" PROXY_ENGINE="$engine" PROXY_MODE=audit \
    "${compose[@]}" up -d --build --wait

  local net
  net=$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$builder")

  echo "--- from another container on $net ---"
  if docker run --rm --network "$net" "$TEST_ALPINE_IMAGE" nc -w 3 -z "$builder" 10024 2>/dev/null; then
    fail "[$engine] :10024 reachable from another container on the compose network"
  else
    pass "[$engine] :10024 not reachable from another container on the compose network"
  fi
  if dns_answered "$net" "$builder"; then
    fail "[$engine] :53/udp answered a query from another container on the compose network"
  else
    pass "[$engine] :53/udp did not answer a query from another container on the compose network"
  fi

  echo "--- from the runner host itself ---"
  local builder_ip
  builder_ip=$(docker inspect -f "{{(index .NetworkSettings.Networks \"$net\").IPAddress}}" "$builder")
  if nc -w 3 -z "$builder_ip" 10024 2>/dev/null; then
    fail "[$engine] :10024 reachable from the runner host"
  else
    pass "[$engine] :10024 not reachable from the runner host"
  fi
  if dns_answered host "$builder_ip"; then
    fail "[$engine] :53/udp answered a query from the runner host"
  else
    pass "[$engine] :53/udp did not answer a query from the runner host"
  fi

  echo "--- internal-address guard covers this container's own gateway and address ---"
  # Only the container can see this gateway, and no other assertion covers it.
  # HOST_ADDRESSES is unset here, so the file holds only what init wrote.
  local own_gw guarded
  own_gw=$(docker exec "$builder" ip -4 route show default | awk '{print $3}' | head -1 || true)
  guarded=$(docker exec "$builder" cat /etc/haproxy/rules/host_addrs.lst 2>/dev/null || true)
  if [ -n "$own_gw" ] && grep -qx "$own_gw" <<< "$guarded"; then
    pass "[$engine] $own_gw is in the internal-address guard"
  else
    fail "[$engine] ${own_gw:-(no default route)} is missing from the internal-address guard"
  fi
  if grep -qx "$builder_ip" <<< "$guarded"; then
    pass "[$engine] the builder's own address $builder_ip is in the internal-address guard"
  else
    fail "[$engine] the builder's own address $builder_ip is missing from the internal-address guard"
  fi

  echo "--- readiness and shutdown ---"

  # A readiness check the container's own INPUT rules block never succeeds,
  # leaving s6-rc's start transition running for the container's whole life.
  # Driven off notification-fd, so a service that gains a check is covered.
  local not_ready=""
  for _ in $(seq 1 20); do
    not_ready=$(docker exec "$builder" sh -c '
      for f in /etc/s6-overlay/s6-rc.d/*/notification-fd; do
        [ -e "$f" ] || continue
        svc=$(basename "$(dirname "$f")")
        s6-svstat "/run/service/$svc" 2>/dev/null | grep -q ", ready " || echo "$svc"
      done' 2>/dev/null || true)
    [ -z "$not_ready" ] && break
    sleep 1
  done
  if [ -z "$not_ready" ]; then
    pass "[$engine] every service declaring a readiness check reached ready"
  else
    fail "[$engine] never reached ready: $not_ready (is its check blocked by init-iptables?)"
  fi

  # Same failure from the other end: an unfinished start transition holds the
  # s6-rc lock the stop transition needs, so the container never exits on
  # SIGTERM and Docker SIGKILLs it, adding 10s to every teardown.
  local started ended code
  started=$(date +%s)
  docker stop -t 30 "$builder" >/dev/null 2>&1 || true
  ended=$(date +%s)
  code=$(docker inspect -f '{{.State.ExitCode}}' "$builder" 2>/dev/null || true)
  if [ "$code" = "0" ]; then
    pass "[$engine] exited on SIGTERM in $((ended - started))s"
  else
    fail "[$engine] did not exit on SIGTERM (exit $code after $((ended - started))s; 137 means it was SIGKILLed)"
  fi
}

run_engine universal
run_engine inspect

assert_results
