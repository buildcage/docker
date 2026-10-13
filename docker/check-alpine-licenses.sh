#!/bin/sh
# Usage: check-alpine-licenses.sh <list> <licenses dir>
# Fails if an installed Alpine package is not in the list, declares another
# license than the list gives, or names a license file missing from the
# directory. Run in the final stage, after its last apk change.
set -eu
list=$1 dir=$2
rc=0
# Through a file: sh has no pipefail to report apk failing mid-list.
raw=$(mktemp)
apk list -I >"$raw"
installed=$(sed -E 's/^(.*)-[^-]+-r[0-9]+ [^ ]+ \{[^}]*\} \((.*)\) \[installed\]$/\1 | \2/' "$raw")
rm -f "$raw"
if [ -z "$installed" ] || echo "$installed" | grep -qv ' | '; then
  echo "cannot read the installed packages from apk list -I" >&2
  exit 1
fi
while IFS= read -r line; do
  pkg=${line%% | *} declared=${line#* | }
  entry=$(awk -F ' [|] ' -v p="$pkg" '$1 == p { print; exit }' "$list")
  if [ -z "$entry" ]; then
    echo "$pkg ($declared) is not in $list" >&2
    rc=1
    continue
  fi
  listed=$(echo "$entry" | awk -F ' [|] ' '{ print $2 }')
  if [ "$listed" != "$declared" ]; then
    echo "$pkg declares $declared, $list says $listed" >&2
    rc=1
  fi
  for f in $(echo "$entry" | awk -F ' [|] ' '{ print $3 }'); do
    if [ "$f" != - ] && [ ! -f "$dir/$f" ]; then
      echo "$pkg: $dir/$f is missing" >&2
      rc=1
    fi
  done
done <<LIST
$installed
LIST
exit "$rc"
