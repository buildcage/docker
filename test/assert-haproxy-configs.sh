#!/bin/bash
# assert-haproxy-configs.sh <engine> <fixture-dir>...: builds <engine>'s image,
# then loads every *.cfg under the fixture dirs, and a config the image's own
# generator writes from a large rule set in each mode, with `haproxy -c` inside
# it. The golden tests pin the generated text; only the HAProxy the image ships
# can say it parses.
#
# CoreDNS has no flag that checks a Corefile without serving it, so the
# Corefile is generated here but not checked.
set -euo pipefail
source "$(dirname "$0")/helpers.sh"

cd "$(dirname "$0")/.."

engine=$1
shift

# Global to the daemon, so it carries the Makefile's worktree suffix.
image="buildcage-haproxy-configs-$engine${BUILDCAGE_WORKTREE_SUFFIX:-}"
trap 'docker rmi "$image" >/dev/null 2>&1 || true' EXIT
build_builder_image "$engine" "$image"

echo ""
echo "=== HAProxy Config Assertions ($engine) ==="
echo ""

# Every check the container has to report on, one per line, so a run that
# stops early cannot pass on the checks it got through.
mounts=()
expected=""
for dir in "$@"; do
  dir=${dir#./}
  mounts+=(-v "$PWD/$dir:/fixtures/$dir:ro")
  cfgs=$(find "$dir" -name '*.cfg' | sort)
  [ -n "$cfgs" ] || fail "no golden *.cfg under $dir"
  expected+="$cfgs"$'\n'
done
expected+="the restrict config generated from a large rule set"$'\n'
expected+="the audit config generated from a large rule set"

status=0
output=$(docker run --rm -i --entrypoint sh ${mounts[@]+"${mounts[@]}"} -e ENGINE="$engine" "$image" -s <<'EOF' 2>&1
set -eu
mkdir -p /etc/haproxy/rules

# Stand-ins for the CA init-cfg writes when the container starts, in the
# images that terminate TLS.
if command -v openssl >/dev/null; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=check \
    -keyout /tmp/k.pem -out /tmp/c.pem 2>/dev/null
  cat /tmp/c.pem /tmp/k.pem > /etc/haproxy/ca.pem
  cp /etc/haproxy/ca.pem /etc/haproxy/default.pem
fi

check() {
  # A pattern or map file a config names is written at start, by init-cfg or
  # the generator, so an empty one stands in for it.
  grep -oE '(-f |map(_[a-z]+)?\(|set-map\()/[^ ),]+' "$1" | sed 's|^[^/]*||' | sort -u |
    while read -r file; do [ -e "$file" ] || : > "$file"; done
  # A warning is held against it too: HAProxy deprecates with one first.
  if out=$(haproxy -c -f "$1" 2>&1) && ! echo "$out" | grep -q WARNING; then
    echo "PASS: $2 loads"
  else
    echo "FAIL: $2 does not load cleanly:"
    echo "$out" | sed 's/^/    /'
  fi
}

for cfg in $(find /fixtures -name '*.cfg' | sort); do
  check "$cfg" "${cfg#/fixtures/}"
done

# Large enough that a limit on words per line or lines per section would show.
awk 'BEGIN { for (i = 0; i < 2000; i++) printf "10.%d.%d.%d\n", int(i / 65536) % 256 + 64, int(i / 256) % 256, i % 256 }' \
  > /tmp/host_addrs.lst
https=$(awk 'BEGIN {
  for (i = 0; i < 400; i++) {
    printf "h%d.example.com:443 *.w%d.example.com:443 **.d%d.example.com:%d ~^r%d\\.example\\.com:(443|8443)$\n", i, i, i, 8000 + i, i
  }
}')
http=$(awk 'BEGIN { for (i = 0; i < 300; i++) printf "h%d.example.org:80 *.w%d.example.org:8080\n", i, i }')
ip=$(awk 'BEGIN {
  for (i = 0; i < 300; i++) printf "172.16.%d.%d:443 10.%d.0.0/16:5432 192.168.%d.*:22\n", i % 256, i % 200, i % 256, i % 256
  print "~^172\\.31\\.\\d+\\.\\d+:9000$"
}')
tls=$(awk 'BEGIN { for (i = 0; i < 200; i++) printf "t%d.example.net:443 *.tw%d.example.net:8443\n", i, i }')
url=$(awk 'BEGIN {
  for (i = 0; i < 300; i++) {
    printf "GET https://u%d.example.io/pkg/**\n", i
    printf "GET|POST|HEAD https://*.uw%d.example.io:8443/v%d/*/files/**\n", i, i
    printf "PUT ~^https://ur%d\\.example\\.io/upload/[a-z0-9]+$\n", i
    printf "GET http://p%d.example.io/pub-*/**\n", i
  }
}')

for mode in restrict audit; do
  if [ "$ENGINE" = inspect ]; then
    qjs --std -m /opt/buildcage/scripts/gen-configs.js /tmp/stress.cfg /tmp/stress.Corefile \
      198.19.255.1 /tmp/host_addrs.lst "$mode" "$https" "$http" "$ip" "$tls" "$url"
  else
    qjs --std -m /opt/buildcage/scripts/gen-configs.js /tmp/stress.cfg /tmp/stress.Corefile \
      198.19.255.1 /tmp/host_addrs.lst "$mode" "$https" "$http" "$ip"
  fi
  check /tmp/stress.cfg "the $mode config generated from a large rule set"
done
EOF
) || status=$?

checked=""
while IFS= read -r line; do
  case "$line" in
    PASS:*)
      pass "${line#PASS: }"
      checked+="${line#PASS: }"$'\n'
      ;;
    FAIL:*)
      fail "${line#FAIL: }"
      checked+="${line#FAIL: }"$'\n'
      ;;
    *) echo "$line" ;;
  esac
done <<< "$output"

[ "$status" -eq 0 ] || fail "the check exited with status $status"
while IFS= read -r name; do
  [ -n "$name" ] || continue
  grep -qxF -e "$name loads" -e "$name does not load cleanly:" <<< "$checked" ||
    fail "$name was never checked"
done <<< "$expected"

assert_results
