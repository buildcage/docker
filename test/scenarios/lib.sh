# shellcheck shell=sh
# Sourced by the scenario scripts beside it, which run inside the cage. Every
# case is reported rather than stopping at the first failure, and
# scenario_results fails the script if any did.

FAILURES=0

pass() { printf '  PASS  %s\n' "$1"; }

fail() {
  printf '  FAIL  %s\n' "$1"
  FAILURES=$((FAILURES + 1))
}

# check_status <label> <got> <want>
check_status() {
  if [ "$2" = "$3" ]; then
    pass "$1"
  else
    fail "$1 -- expected $3, got $2"
  fi
}

# check_ok <label> <body> <marker>: the fixture origins answer with a marker
# naming the path and method, and nothing after it matters here.
check_ok() {
  case "$2" in
    "$3"*) pass "$1" ;;
    *) fail "$1 -- got: $2" ;;
  esac
}

# attempt <curl command...>: the status the command prints with -w, then
# curl's exit code, as check_blocked reads them: "403 0", "000 56".
attempt() {
  _status=$("$@" 2> /dev/null)
  set -- "$?"
  printf '%s %s\n' "${_status:-000}" "$1"
}

# check_blocked <label> <what attempt printed>: anything but a 200, since a
# block can end as a status, a reset or a timeout depending on where it was
# made. Any other curl failure means the request never reached the proxy, so it
# proves nothing.
check_blocked() {
  case "${2##* }" in
    # 0: a status. 7: refused. 28: timed out. 35: reset in the handshake.
    # 52, 55, 56: closed or reset once connected.
    0 | 7 | 28 | 35 | 52 | 55 | 56) ;;
    *)
      fail "$1 -- curl exited ${2##* } before the proxy could decide"
      return
      ;;
  esac
  if [ "${2%% *}" != "200" ]; then
    pass "$1 blocked (got ${2%% *})"
  else
    fail "$1 reached the origin"
  fi
}

# greeting <host> <port> <seconds>: what a server that speaks first sends
# within <seconds> to a client that sends nothing. stdin stays open exactly as
# long, so nc neither leaves early nor keeps the caller waiting past it.
greeting() {
  sleep "$3" | timeout "$3" nc "$1" "$2" 2> /dev/null || true
}

# reply_head <bytes> <host> <port> <printf format>: the first <bytes> bytes
# the server answers the formatted request with, in hex. It returns once they
# arrive: a server may hold the connection open after replying, and nc would
# otherwise wait out -w.
reply_head() {
  _fifo=$(mktemp -u)
  mkfifo "$_fifo"
  # shellcheck disable=SC2059 # the format is the request
  printf "$4" | nc -w 5 "$2" "$3" > "$_fifo" 2> /dev/null &
  _pid=$!
  head -c "$1" "$_fifo" | od -An -tx1 | tr -d ' \n'
  kill "$_pid" 2> /dev/null
  wait "$_pid" 2> /dev/null
  rm -f "$_fifo"
}

# sni_colon_hello: a ClientHello whose SNI is
# tlsany.example.com:x.evil.example.net, which ~^tlsany\.example\.com:.*$ would
# match and the resolver then look up under evil.example.net.
sni_colon_hello() {
  printf '\026\003\001\000\135\001\000\000\131\003\003\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\002\000\377\001\000\000\056\000\000\000\052\000\050\000\000\045\164\154\163\141\156\171\056\145\170\141\155\160\154\145\056\143\157\155\072\170\056\145\166\151\154\056\145\170\141\155\160\154\145\056\156\145\164'
}

scenario_results() {
  printf '=== End of %s: %s failure(s) ===\n' "$1" "$FAILURES"
  [ "$FAILURES" -eq 0 ]
}
